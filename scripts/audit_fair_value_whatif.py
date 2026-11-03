"""What-if measurement of two candidate fair-value rule changes (plan §11 items 4 and 5).

Plan: docs/superpowers/specs/2026-11-01-fair-value-refusal-outlier-plan.md (§10-§11).
Baseline: docs/reports/2026-11-fair-value-audit.md (`scripts/audit_fair_value.py`).

Runs the Damodaran fair value (`fair_value.generate_fair_value_case_for_ticker`) over the whole
watchlist once per scenario, each scenario with one rule changed. Nothing in the app is edited: the
rule change is a wrapper around `fair_value.build_fair_value_case`, installed for the scenario only,
and every scenario stores its cases under its own name suffix so none reuses another's stored case.

Scenarios (each alone):
- base:  the current rules.
- 4a:    cyclical normalisation. For COMMODITY industries the industry 5y revenue growth in the blend
         is replaced by the riskfree rate: g = (company CAGR + riskfree) / 2, same clamp.
- 4b:    4a, and the margin target of those industries is the industry's operating margin (mid-cycle).
- 5a:    a laggard's (base margin < industry margin) margin target is the full industry margin.
- 5b:    a laggard's margin target is max(base margin, 0.75 x industry margin).

It NEVER touches the real database: it copies it to a temporary file (or uses --db, which must not
be data/processed/moneyview.db) and points the app at the copy. Nothing is fetched.

usage: python scripts/audit_fair_value_whatif.py [--db COPY] [--out REPORT.md]
"""
from __future__ import annotations

import argparse
import os
import shutil
import statistics
import sys
import tempfile
from dataclasses import replace
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

from audit_fair_value import NOT_OPERATING, REAL_DB, _code, _fmt, _quantiles, _ratio  # noqa: E402

# Damodaran industry names (as stored in the vintage) treated as commodity-price cyclical.
COMMODITY = (
    "Precious Metals", "Metals & Mining", "Steel", "Coal & Related Energy",
    "Oil/Gas (Production and Exploration)", "Oil/Gas (Integrated)", "Oilfield Svcs/Equip.",
    "Chemical (Basic)", "Paper/Forest Products", "Farming/Agriculture",
)
LAGGARD_FOCUS = ("Semiconductor", "Semiconductor Equip", "Software (System & Application)",
                 "Software (Internet)", "Computers/Peripherals")
VARIANTS = ("4a", "4b", "5a", "5b")
LABEL = {"base": "Baseline", "4a": "④a growth normalised", "4b": "④b growth + mid-cycle margin",
         "5a": "⑤a laggard to full industry margin", "5b": "⑤b laggard to max(base, 0.75 x industry)"}
MOVE = 0.30


def _retarget_margin(payload: dict, target: float, industry) -> None:
    """Set the margin target and redo the two inputs derived from it (terminal return and growth)."""
    from apps.api.services.fair_value_case import _industry_value

    segment = payload["segments"][0]
    segment["margin_target"] = target
    implied = target * (1.0 - payload["marginal_tax_rate"]) * segment["sales_to_capital_early"]
    roic = min(_industry_value(industry, "after_tax_roc"), implied)
    payload["roic_stable"] = roic
    payload["terminal_growth"] = 0.0 if roic <= payload["wacc_stable"] else None


def _install(variant: str):
    """Patch `fair_value` for one scenario; returns the undo function."""
    from apps.api.services import fair_value as fv
    from apps.api.services.fair_value_case import _industry_value

    orig_build, orig_name = fv.build_fair_value_case, fv.fair_value_case_name

    def name(ticker, vintage, latest_year):
        return f"{orig_name(ticker, vintage, latest_year)}_wi{variant}"

    def build(ticker, baseline, industry, **kw):
        commodity = industry.name in COMMODITY
        used = industry
        if variant in ("4a", "4b") and commodity:
            used = replace(industry, values={**industry.values, "revenue_growth": kw["riskfree_rate"]})
        payload = orig_build(ticker, baseline, used, **kw)
        payload["case_name"] = name(ticker, kw["vintage"], kw["latest_year"])
        base_m, ind_m = baseline.base_margin, _industry_value(industry, "operating_margin")
        target = payload["segments"][0]["margin_target"]
        if variant == "4b" and commodity:
            target = ind_m
        elif variant == "5a" and base_m < ind_m:
            target = ind_m
        elif variant == "5b" and base_m < ind_m:
            target = max(base_m, 0.75 * ind_m)
        if variant == "base":  # reconstruction check: re-deriving the unchanged target changes nothing
            before = (payload["roic_stable"], payload["terminal_growth"])
            _retarget_margin(payload, target, industry)
            assert before == (payload["roic_stable"], payload["terminal_growth"]), ticker
        elif target != payload["segments"][0]["margin_target"] or variant in ("4a", "4b"):
            _retarget_margin(payload, target, industry)
        return payload

    fv.build_fair_value_case, fv.fair_value_case_name = build, name

    def undo():
        fv.build_fair_value_case, fv.fair_value_case_name = orig_build, orig_name

    return undo


def run_scenario(variant: str, tickers_and_types) -> dict:
    from apps.api.services.acquisition.store import load_price_bars
    from apps.api.services.fair_value import generate_fair_value_case_for_ticker
    from apps.api.services.industry_benchmark_store import industry_row_for_ticker
    from apps.api.services.valuation_case import run_stored_case

    undo = _install(variant)
    out = {}
    try:
        for ticker, kind in tickers_and_types:
            if (kind or "").lower() in NOT_OPERATING:
                continue
            row = {"status": None}
            out[ticker] = row
            industry, _, _ = industry_row_for_ticker(ticker)
            row["industry"] = industry.name if industry is not None else "(none)"
            bars = [b for b in load_price_bars(ticker, limit=5) if b.get("close")]
            price = float(bars[-1]["close"]) if bars else None
            try:
                case_id, _c, _v, reason = generate_fair_value_case_for_ticker(ticker)
                if reason is not None:
                    row["status"], row["reason"] = _code(reason), reason
                    continue
                value = run_stored_case(case_id)["value_per_share_diluted"]
                row.update(status="valued", value=value, ratio=_ratio(value, price))
            except Exception as exc:  # noqa: BLE001 - recorded and counted
                row["status"], row["reason"] = f"error_{type(exc).__name__}", str(exc)[:200]
    finally:
        undo()
    return out


def _summary(res: dict) -> dict:
    valued = [r for r in res.values() if r["status"] == "valued"]
    ratios = [r["ratio"] for r in valued if r["ratio"] is not None]
    q = _quantiles(ratios) or {}
    refused = {}
    for r in res.values():
        if r["status"] != "valued":
            refused[r["status"]] = refused.get(r["status"], 0) + 1
    return {"valued": len(valued), "refused": sum(refused.values()), "refused_codes": refused, "q": q,
            "ge3": sum(1 for v in ratios if v >= 3), "lt05": sum(1 for v in ratios if 0 < v < 0.5),
            "le0": sum(1 for v in ratios if v <= 0), "n_ratio": len(ratios)}


def _movers(base: dict, var: dict):
    moved, newly_refused, newly_valued = [], [], []
    for t, b in base.items():
        a = var[t]
        if b["status"] == "valued" and a["status"] != "valued":
            newly_refused.append((t, b, a))
        elif b["status"] != "valued" and a["status"] == "valued":
            newly_valued.append((t, b, a))
        elif b["status"] == "valued" and b.get("ratio") is not None and a.get("ratio") is not None:
            if b["ratio"] > 0 and a["ratio"] > 0:
                change = a["ratio"] / b["ratio"] - 1
            else:
                change = float("inf") if a["ratio"] != b["ratio"] else 0.0
            if abs(change) > MOVE:
                moved.append((t, b, a, change))
    moved.sort(key=lambda m: -abs(m[3]) if m[3] != float("inf") else -1e9)
    return moved, newly_refused, newly_valued


def _median(values):
    return statistics.median(values) if values else None


def report(results: dict, vintage: str, copy_date: str) -> str:
    base = results["base"]
    n_op = len(base)
    out = [f"# Fair value what-if: two candidate rule changes ({date.today().isoformat()})", "",
           "Generated by `scripts/audit_fair_value_whatif.py`. Nothing here changes a valuation: each variant is "
           "applied alone, by wrapping the case builder, on a copy of the local database "
           f"(copied {copy_date}; Damodaran industry vintage {vintage}). Plan: "
           "`docs/superpowers/specs/2026-11-01-fair-value-refusal-outlier-plan.md` §10-§11.", "",
           f"Operating companies measured: {n_op}. Prices are the last stored close.", "",
           "- **Baseline**: years 1-5 growth = clamp((company 3y CAGR + industry 5y growth)/2, -5%, 25%); "
           "margin target = own margin for a leader, halfway to the industry for a laggard.",
           "- **④a**: for the commodity industries below, the industry growth in the blend is the riskfree "
           "rate (no extrapolation of the commodity cycle); same clamp.",
           "- **④b**: ④a, and the margin target of those industries is the industry operating margin "
           "(mid-cycle), for leaders and laggards alike.",
           "- **⑤a**: a laggard's margin target is the full industry margin.",
           "- **⑤b**: a laggard's margin target is max(base margin, 0.75 x industry margin).", "",
           "Commodity set used for ④ (exact stored names): " + "; ".join(f"`{n}`" for n in COMMODITY)
           + ". Of these, the watchlist holds: "
           + ", ".join(f"{n} ({sum(1 for r in base.values() if r['industry'] == n)})" for n in COMMODITY
                       if any(r["industry"] == n for r in base.values()))
           + ". (`Oil/Gas Distribution` is not in the set: a pipeline/midstream business, not a price taker.)", "",
           "## Summary", "",
           "| Scenario | Valued | Refused | Median FV/P | p10 | p25 | p75 | p90 | >= 3x | < 0.5x (positive) | <= 0 |",
           "|---|---|---|---|---|---|---|---|---|---|---|"]
    sums = {k: _summary(v) for k, v in results.items()}
    for k in ("base", *VARIANTS):
        s, q = sums[k], sums[k]["q"]
        out.append(f"| {LABEL[k]} | {s['valued']} | {s['refused']} | {_fmt(q.get('p50'))} | {_fmt(q.get('p10'))} | "
                   f"{_fmt(q.get('p25'))} | {_fmt(q.get('p75'))} | {_fmt(q.get('p90'))} | {s['ge3']} | "
                   f"{s['lt05']} | {s['le0']} |")
    out += ["", "FV/P = fair value per share / last close. 'Valued' counts every ticker the builder and engine "
            "accept, including those whose value is non-positive (counted again in the last column); the app "
            "shows those as 'not computable'.", "",
            "### Refusals by code", "", "| Scenario | Codes |", "|---|---|"]
    for k in ("base", *VARIANTS):
        codes = ", ".join(f"`{c}` {n}" for c, n in sorted(sums[k]["refused_codes"].items(), key=lambda x: -x[1]))
        out.append(f"| {LABEL[k]} | {codes} |")
    out.append("")

    notes = {
        "4a": "Factual: only commodity-industry tickers can change; the 25% growth cap no longer binds for them.",
        "4b": "Factual: also lowers (or raises) margins to the industry's for every commodity-industry ticker, "
              "including those below it.",
        "5a": "Factual: only laggards (base margin below industry) change; leaders are untouched.",
        "5b": "Factual: only laggards change; a laggard above 75% of the industry margin keeps its own margin.",
    }
    focus = {"4a": COMMODITY, "4b": COMMODITY, "5a": LAGGARD_FOCUS, "5b": LAGGARD_FOCUS}
    for v in VARIANTS:
        var = results[v]
        moved, nref, nval = _movers(base, var)
        out += [f"## {LABEL[v]}", "", notes[v], ""]
        out += [f"Focus industries (valued in both): median FV/P and count below 0.5x.", "",
                "| Industry | n | median before | median after | < 0.5x before | < 0.5x after | >= 3x before | >= 3x after |",
                "|---|---|---|---|---|---|---|---|"]
        for ind in focus[v]:
            ts = [t for t, r in base.items() if r["industry"] == ind and r["status"] == "valued"
                  and var[t]["status"] == "valued" and r.get("ratio") is not None and var[t].get("ratio") is not None]
            if not ts:
                continue
            b = [base[t]["ratio"] for t in ts]
            a = [var[t]["ratio"] for t in ts]
            out.append(f"| {ind} | {len(ts)} | {_fmt(_median(b))} | {_fmt(_median(a))} | "
                       f"{sum(x < 0.5 for x in b)} | {sum(x < 0.5 for x in a)} | "
                       f"{sum(x >= 3 for x in b)} | {sum(x >= 3 for x in a)} |")
        out.append("")
        out += [f"Tickers whose FV/P moves by more than {int(MOVE * 100)}%: {len(moved)} "
                f"(newly refused: {len(nref)}, newly valued: {len(nval)}).", ""]
        if moved:
            out += [f"| Ticker | Industry | FV/P before | FV/P after | Change |", "|---|---|---|---|---|"]
            for t, b, a, ch in moved[:25]:
                change = "from non-positive" if ch == float("inf") else f"{ch * 100:+.0f}%"
                out.append(f"| {t} | {b['industry']} | {_fmt(b['ratio'])} | {_fmt(a['ratio'])} | {change} |")
            if len(moved) > 25:
                out.append(f"| ... | {len(moved) - 25} more not shown | | | |")
            out.append("")
        for title, items in (("Newly refused", nref), ("Newly valued", nval)):
            if items:
                out += [f"{title}:", "", "| Ticker | Industry | Before | After |", "|---|---|---|---|"]
                for t, b, a in items[:25]:
                    show = lambda r: _fmt(r.get("ratio")) if r["status"] == "valued" else (r.get("reason") or r["status"]).replace("|", "/")
                    out.append(f"| {t} | {b['industry']} | {show(b)} | {show(a)} |")
                out.append("")
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", type=Path, help="a COPY of the database to use (default: a fresh temporary copy)")
    parser.add_argument("--out", type=Path, help="write the markdown report here (default: stdout)")
    args = parser.parse_args()

    if args.db is not None and args.db.resolve() == REAL_DB.resolve():
        print("refusing to run on the real database; pass a copy", file=sys.stderr)
        return 2
    temp_dir = None
    if args.db is None:
        temp_dir = tempfile.mkdtemp(prefix="mv-fv-whatif-")
        db_path = Path(temp_dir) / "moneyview.db"
        shutil.copy2(REAL_DB, db_path)
    else:
        db_path = args.db

    os.environ.setdefault("MONEYVIEW_DISABLE_STARTUP_JOBS", "1")
    from apps.api.services import db as db_service

    db_service._DB_PATH = db_path
    try:
        with db_service.get_db() as conn:
            types = dict(conn.execute("SELECT ticker, instrument_type FROM corporate_quote_facts").fetchall())
            tickers = [r[0] for r in conn.execute("SELECT ticker FROM watchlist ORDER BY ticker")]
        from apps.api.services.industry_benchmark_store import latest_vintage

        pairs = [(t, types.get(t)) for t in tickers]
        results = {}
        for key in ("base", *VARIANTS):
            print(f"scenario {key} ...", file=sys.stderr)
            results[key] = run_scenario(key, pairs)
        text = report(results, latest_vintage() or "?", date.today().isoformat())
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
