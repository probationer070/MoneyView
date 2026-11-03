"""Which inputs drive the Damodaran fair value of one industry? One-at-a-time sensitivity.

Read-only diagnosis (plan: docs/superpowers/specs/2026-11-01-fair-value-refusal-outlier-plan.md §10-§12).
For every watchlist ticker whose Damodaran industry is the one named, it builds the fair-value case
with the app's own builder (`fair_value.build_fair_value_case`, captured through a wrapper, so the
inputs are the real ones), then re-runs the engine on a modified copy of the payload: one input
changed per scenario, the rest kept. It also solves the year 1-5 growth the last close implies
(`fair_value_case.implied_growth`).

Nothing in the app is edited and the real database is never written: like `audit_fair_value.py` it
works on a temporary copy of data/processed/moneyview.db (or --db, which must not be the real one).
Cases are stored in that copy only, under a `_dg` name suffix. Nothing is fetched.

usage: python scripts/diagnose_fair_value_group.py "Semiconductor" [--names NVDA,AMD,...]
                                                   [--db COPY] [--out REPORT.md]
The industry name is the stored Damodaran name (exact), e.g. "Semiconductor", "Semiconductor Equip".
"""
from __future__ import annotations

import argparse
import os
import shutil
import statistics
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

from audit_fair_value import NOT_OPERATING, REAL_DB, _code, _fmt, _pct, _quantiles  # noqa: E402

DEFAULT_NAMES = ("NVDA", "AMD", "AVGO", "MU", "QCOM", "INTC")


def _pctile(values, q):
    values = sorted(values)
    if len(values) < 2:
        return values[0] if values else None
    return statistics.quantiles(values, n=20)[q - 1]  # q in 1..19, 5% steps


def _retarget(p: dict, industry, roc_only: bool = False, nudge: bool = False) -> None:
    """Re-derive the terminal return/growth from the payload's current margin, sales to capital, WACC."""
    from apps.api.services.fair_value_case import _industry_value

    seg = p["segments"][0]
    implied = seg["margin_target"] * (1.0 - p["marginal_tax_rate"]) * seg["sales_to_capital_early"]
    roc = _industry_value(industry, "after_tax_roc")
    roic = roc if roc_only else min(roc, implied)
    if nudge and roic <= p["wacc_stable"]:
        roic = p["wacc_stable"] + 1e-4  # terminal growth stays at riskfree: the spread is ~zero
    p["roic_stable"] = roic
    p["terminal_growth"] = 0.0 if roic <= p["wacc_stable"] else None


def _scenarios(ctx: dict):
    """(label, function(payload) -> None) pairs; each mutates a deep copy of the base payload."""
    from apps.api.services.fair_value_case import GROWTH_FLOOR, _revenue_target

    b, ind, kw = ctx["baseline"], ctx["industry"], ctx["kw"]
    cg, ig, rf = kw["company_growth"], ctx["ind_growth"], kw["riskfree_rate"]

    def set_g(p, g):
        seg = p["segments"][0]
        seg["revenue_target"] = _revenue_target(seg["base_revenue"], g, p["riskfree_rate"])
        p["_g"] = g

    def g_blend(cap):
        return lambda p: set_g(p, min(max((cg + ig) / 2.0, GROWTH_FLOOR), cap))

    def s2c(p):
        seg = p["segments"][0]
        seg["sales_to_capital_early"] = seg["sales_to_capital_late"] = b.current_sales_to_capital
        _retarget(p, ind)

    def margin(p, value):
        p["segments"][0]["margin_target"] = value
        _retarget(p, ind)

    def wacc_company(p):
        p["wacc_stable"] = b.current_wacc
        _retarget(p, ind)

    def wacc_initial_industry(p):
        p["wacc_initial"] = p["wacc_stable"]

    def term_roc_only(p):
        _retarget(p, ind, roc_only=True)

    def term_nudge(p):
        _retarget(p, ind, nudge=True)

    def term_roc_nudge(p):
        _retarget(p, ind, roc_only=True, nudge=True)

    def all_own(p):
        set_g(p, cg)
        s2c(p)
        wacc_company(p)
        margin(p, b.base_margin)

    return [
        ("Base (current rules)", lambda p: None),
        ("Growth cap 25% -> 35%", g_blend(0.35)),
        ("Growth cap removed (blend, floor kept)", g_blend(float("inf"))),
        ("Growth = company 3y CAGR, uncapped", lambda p: set_g(p, cg)),
        ("Growth = industry 5y growth only", lambda p: set_g(p, ig)),
        ("sales_to_capital: industry -> company's own", s2c),
        ("Terminal ROIC: no zero-growth fallback (ROIC = WACC + 1bp, growth = riskfree)", term_nudge),
        ("Terminal ROIC = industry after-tax ROC (no min with implied)", term_roc_only),
        ("Both of the two terminal changes", term_roc_nudge),
        ("WACC stable: industry -> company WACC", wacc_company),
        ("WACC initial: company -> industry WACC (flat)", wacc_initial_industry),
        ("Margin target: -> company's own margin", lambda p: margin(p, b.base_margin)),
        ("Margin target: -> industry margin", lambda p: margin(p, ctx["ind_margin"])),
        ("Company CAGR uncapped + own margin", lambda p: (set_g(p, cg), margin(p, b.base_margin))),
        ("Company CAGR + own margin + own sales_to_capital", lambda p: (set_g(p, cg), margin(p, b.base_margin), s2c(p))),
        ("All company-own (CAGR, margin, s2c, WACC)", all_own),
        ("Generous bundle: industry margin + flat industry WACC + growth cap 35%",
         lambda p: (g_blend(0.35)(p), wacc_initial_industry(p), margin(p, ctx["ind_margin"]))),
    ]


def collect(industry_name: str):
    """Build the real case payload for each watchlist ticker in the industry."""
    from apps.api.services import db as db_service
    from apps.api.services import fair_value as fv
    from apps.api.services.acquisition.store import load_price_bars
    from apps.api.services.fair_value_case import _industry_value
    from apps.api.services.industry_benchmark_store import industry_row_for_ticker

    with db_service.get_db() as conn:
        types = dict(conn.execute("SELECT ticker, instrument_type FROM corporate_quote_facts").fetchall())
        tickers = [r[0] for r in conn.execute("SELECT ticker FROM watchlist ORDER BY ticker")]

    seen: dict[str, dict] = {}
    orig_build, orig_name = fv.build_fair_value_case, fv.fair_value_case_name

    def name(ticker, vintage, latest_year, **extra):
        return f"{orig_name(ticker, vintage, latest_year, **extra)}_dg"

    def build(ticker, baseline, industry, **kw):
        payload = orig_build(ticker, baseline, industry, **kw)
        payload["case_name"] = f'{payload["case_name"]}_dg'
        seen[ticker] = {"baseline": baseline, "industry": industry, "kw": kw, "payload": payload,
                        "ind_growth": _industry_value(industry, "revenue_growth"),
                        "ind_margin": _industry_value(industry, "operating_margin"),
                        "ind_s2c": _industry_value(industry, "sales_to_capital")}
        return payload

    fv.build_fair_value_case, fv.fair_value_case_name = build, name
    refused = {}
    try:
        for t in tickers:
            if (types.get(t) or "").lower() in NOT_OPERATING:
                continue
            ind, _, _ = industry_row_for_ticker(t)
            if ind is None or ind.name != industry_name:
                continue
            bars = [x for x in load_price_bars(t, limit=5) if x.get("close")]
            price = float(bars[-1]["close"]) if bars else None
            case_id, _c, _v, reason = fv.generate_fair_value_case_for_ticker(t)
            if reason is not None or t not in seen or not price:
                refused[t] = _code(reason) if reason else "no_price_or_case"
                seen.pop(t, None)
                continue
            seen[t]["price"] = price
    finally:
        fv.build_fair_value_case, fv.fair_value_case_name = orig_build, orig_name
    return seen, refused


def run_value(payload: dict) -> float | None:
    from apps.api.services.valuation_case import _specs_from_payload
    from packages.core_finance.segment_valuation import run_case

    clean = {k: v for k, v in payload.items() if not k.startswith("_")}
    try:
        return run_case(*_specs_from_payload(clean))
    except Exception:  # noqa: BLE001 - a scenario the engine refuses is reported as such
        return None


def analyse(industry_name: str, names) -> str:
    import copy

    from apps.api.services.fair_value_case import implied_growth

    ctxs, refused = collect(industry_name)
    tickers = sorted(ctxs)
    out = [f"# {industry_name}: fair value diagnosis (n={len(tickers)} valued-eligible tickers)", ""]
    if refused:
        out += ["Not measured: " + ", ".join(f"{t} ({c})" for t, c in sorted(refused.items())), ""]

    # 1. inputs
    out += ["## Stored case inputs", "",
            "| Ticker | Base rev (bn) | Base margin | Margin tgt | Co CAGR | Ind growth | g 1-5 | s2c ind | s2c own | "
            "WACC0 | WACC stable | WACC co | ROIC stable | Term g | TV share | FV/P | Implied g (price) |",
            "|" + "---|" * 17]
    base_ratio = {}
    for t in tickers:
        c = ctxs[t]
        p = c["payload"]
        res = run_value(p)
        seg = p["segments"][0]
        g, why = implied_growth(p, c["price"])
        base_ratio[t] = res.value_per_share_diluted / c["price"] if res else None
        c["implied_g"], c["implied_why"] = g, why
        g15 = min(max((c["kw"]["company_growth"] + c["ind_growth"]) / 2, -0.05), 0.25)
        tg = p["terminal_growth"] if p["terminal_growth"] is not None else p["riskfree_rate"]
        mark = "**" if t in names else ""
        out.append(
            f"| {mark}{t}{mark} | {seg['base_revenue']:.2f} | {_pct(seg['base_margin'])} | {_pct(seg['margin_target'])} | "
            f"{_pct(c['kw']['company_growth'])} | {_pct(c['ind_growth'])} | {_pct(g15)} | {seg['sales_to_capital_early']:.2f} | "
            f"{c['baseline'].current_sales_to_capital:.2f} | {_pct(p['wacc_initial'])} | {_pct(p['wacc_stable'])} | "
            f"{_pct(c['baseline'].current_wacc)} | {_pct(p['roic_stable'])} | {_pct(tg)} | "
            f"{_pct(res.terminal_value_share_pct / 100) if res else '—'} | {_fmt(base_ratio[t])} | "
            f"{_pct(g) if g is not None else (why or '—').split(':')[0]} |")
    out.append("")
    med = lambda xs: statistics.median(xs) if xs else None
    out += ["Group medians: base margin " + _pct(med([ctxs[t]['baseline'].base_margin for t in tickers]))
            + ", g 1-5 (model) " + _pct(med([min(max((ctxs[t]['kw']['company_growth'] + ctxs[t]['ind_growth']) / 2, -0.05), 0.25) for t in tickers]))
            + ", implied g " + _pct(med([ctxs[t]['implied_g'] for t in tickers if ctxs[t]['implied_g'] is not None]))
            + f" (n={sum(1 for t in tickers if ctxs[t]['implied_g'] is not None)}; "
            + f"{sum(1 for t in tickers if ctxs[t]['implied_g'] is None)} outside [-20%, 60%]).", ""]

    # 2. sensitivity
    labels = [lbl for lbl, _ in _scenarios(ctxs[tickers[0]])]
    table = {lbl: {} for lbl in labels}
    for t in tickers:
        for lbl, fn in _scenarios(ctxs[t]):
            p = copy.deepcopy(ctxs[t]["payload"])
            try:
                fn(p)
                r = run_value(p)
            except Exception:  # noqa: BLE001
                r = None
            table[lbl][t] = (r.value_per_share_diluted / ctxs[t]["price"]) if r else None
    out += ["## One-at-a-time sensitivity (FV/P = fair value per share / last close)", "",
            "| Change (everything else kept) | n | median | p25 | p75 | tickers >= 1x | engine refused |",
            "|---|---|---|---|---|---|---|"]
    for lbl in labels:
        vals = [v for v in table[lbl].values() if v is not None]
        out.append(f"| {lbl} | {len(vals)} | {_fmt(med(vals))} | {_fmt(_pctile(vals, 5))} | {_fmt(_pctile(vals, 15))} | "
                   f"{sum(v >= 1 for v in vals)} | {len(table[lbl]) - len(vals)} |")
    out.append("")
    named = [t for t in names if t in ctxs]
    if named:
        out += ["### Named tickers: FV/P under each change", "", "| Change | " + " | ".join(named) + " |",
                "|---|" + "---|" * len(named)]
        for lbl in labels:
            out.append(f"| {lbl} | " + " | ".join(_fmt(table[lbl].get(t)) for t in named) + " |")
        out.append("")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("industry", help="stored Damodaran industry name, e.g. Semiconductor")
    ap.add_argument("--names", default=",".join(DEFAULT_NAMES), help="tickers to show individually")
    ap.add_argument("--db", type=Path, help="a COPY of the database (default: a fresh temporary copy)")
    ap.add_argument("--out", type=Path, help="write the markdown here (default: stdout)")
    args = ap.parse_args()
    if args.db is not None and args.db.resolve() == REAL_DB.resolve():
        print("refusing to run on the real database; pass a copy", file=sys.stderr)
        return 2
    temp_dir = None
    if args.db is None:
        temp_dir = tempfile.mkdtemp(prefix="mv-fv-diag-")
        db_path = Path(temp_dir) / "moneyview.db"
        shutil.copy2(REAL_DB, db_path)
    else:
        db_path = args.db
    os.environ.setdefault("MONEYVIEW_DISABLE_STARTUP_JOBS", "1")
    from apps.api.services import db as db_service

    db_service._DB_PATH = db_path
    try:
        text = analyse(args.industry, [n.strip().upper() for n in args.names.split(",") if n.strip()])
        if args.out:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(text, encoding="utf-8")
        else:
            print(text)
    finally:
        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
