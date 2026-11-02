"""Stage 0 of the fair-value plan: measure where the valuations refuse or run large.

Plan: docs/superpowers/specs/2026-11-01-fair-value-refusal-outlier-plan.md (stage 0).

For every watchlist ticker it records:
- the Damodaran fair value (`fair_value.generate_fair_value_case_for_ticker`): the value per share, or
  the refusal code; the value against the last close; the implied EV/Sales against the industry's and
  the market's; and the inputs that make the value (growth, margins, sales to capital, WACC, ROIC);
- the Corporate tab's 5-year DCF (`corporate_comparison._dcf_snapshot`, the decision log's loader): the
  value, or its refusal, and the gap to price.

It NEVER touches the real database: generating a fair value stores a case, so the script copies the
database to a temporary file first (or uses --db, which must not be data/processed/moneyview.db) and
points the app at the copy. Nothing is fetched: every loader reads the local store.

usage: python scripts/audit_fair_value.py [--db COPY] [--out REPORT.md] [--csv ROWS.csv]
"""
from __future__ import annotations

import argparse
import csv
import os
import shutil
import statistics
import sys
import tempfile
from collections import Counter
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REAL_DB = REPO / "data" / "processed" / "moneyview.db"
NOT_OPERATING = {"etf", "index", "mutualfund", "currency", "cryptocurrency", "future"}


def _code(reason: str) -> str:
    return reason.split(":", 1)[0].strip() or "unknown"


def _ratio(a, b):
    return a / b if a is not None and b not in (None, 0) else None


def _fmt(value, digits=2):
    return "—" if value is None else f"{value:.{digits}f}"


def _pct(value):
    return "—" if value is None else f"{value * 100:.1f}%"


def _quantiles(values):
    values = sorted(v for v in values if v is not None)
    if len(values) < 4:
        return None
    q = statistics.quantiles(values, n=20)  # 5% steps
    return {"n": len(values), "p10": q[1], "p25": q[4], "p50": statistics.median(values), "p75": q[14], "p90": q[17]}


def measure(tickers_and_types):
    # Imported here: they must see the copied database path.
    from apps.api.services.acquisition.store import load_price_bars
    from apps.api.services.fair_value import generate_fair_value_case_for_ticker
    from apps.api.services.industry_benchmark_store import industry_row_for_ticker
    from apps.api.services.investment_decision import (
        DEFAULT_EQUITY_RISK_PREMIUM, DEFAULT_RISK_FREE_RATE, _default_figures_loader,
    )
    from apps.api.services.valuation_case import load_case, run_stored_case

    rows = []
    for ticker, kind in tickers_and_types:
        row = {"ticker": ticker, "instrument_type": kind or ""}
        rows.append(row)
        if (kind or "").lower() in NOT_OPERATING:
            row["fv_status"] = row["dcf_status"] = "not_an_operating_company"
            continue

        bars = [b for b in load_price_bars(ticker, limit=5) if b.get("close")]
        price = float(bars[-1]["close"]) if bars else None
        row["price"] = price

        industry, _, industry_reason = industry_row_for_ticker(ticker)
        if industry is not None:
            row["industry"] = industry.name
            row["ind_margin"] = industry.values.get("operating_margin")
            row["ind_growth"] = industry.values.get("revenue_growth")
            row["ind_ev_sales"] = industry.values.get("ev_sales")
            row["ind_s2c"] = industry.values.get("sales_to_capital")
        else:
            row["industry"] = f"({_code(industry_reason or '')})"

        # Damodaran fair value (10-year case, own industry).
        try:
            case_id, _created, _vintage, reason = generate_fair_value_case_for_ticker(ticker)
            if reason is not None:
                row["fv_status"] = _code(reason)
                row["fv_reason"] = reason
            else:
                result = run_stored_case(case_id)
                case = load_case(case_id)
                segment = case["segments"][0]
                value = result["value_per_share_diluted"]
                revenue = result["base_revenue_total"]
                shares = case["shares_basic"] + case["shares_new"]
                row.update({
                    "fv_status": "valued",
                    "fv_value": value,
                    "fv_to_price": _ratio(value, price),
                    "implied_ev_sales": _ratio(result["enterprise_value"], revenue),
                    "market_ev_sales": _ratio(price * shares + case["debt"] - case["cash"], revenue) if price else None,
                    "terminal_share": result["terminal_value_share_pct"] / 100,
                    "base_margin": segment["base_margin"],
                    "margin_target": segment["margin_target"],
                    "s2c": segment["sales_to_capital_early"],
                    "growth_10y_cagr": (segment["revenue_target"] / segment["base_revenue"]) ** (1 / 10) - 1
                    if segment["base_revenue"] > 0 else None,
                    "wacc_initial": case["wacc_initial"],
                    "wacc_stable": case["wacc_stable"],
                    "roic_stable": case["roic_stable"],
                })
                row["ev_sales_vs_industry"] = _ratio(row["implied_ev_sales"], row.get("ind_ev_sales"))
        except Exception as exc:  # noqa: BLE001 - a crash is a finding, recorded and counted
            row["fv_status"] = f"error_{type(exc).__name__}"
            row["fv_reason"] = str(exc)[:300]

        # Corporate tab 5-year DCF.
        try:
            figures = _default_figures_loader(
                ticker, risk_free_rate=DEFAULT_RISK_FREE_RATE, equity_risk_premium=DEFAULT_EQUITY_RISK_PREMIUM
            )
            if figures.get("dcf_refusal"):
                row["dcf_status"] = "non_positive_fcff"
            elif figures.get("bridge_quality") == "missing":
                row["dcf_status"] = "bridge_missing"
            elif figures.get("metrics_are_real") is False:
                row["dcf_status"] = "default_metrics"
            elif not figures.get("price_at_decision"):
                row["dcf_status"] = "no_price"
            else:
                row["dcf_status"] = "valued"
                row["dcf_value"] = figures["dcf_value"]
                row["dcf_to_price"] = _ratio(figures["dcf_value"], figures["price_at_decision"])
        except Exception as exc:  # noqa: BLE001
            row["dcf_status"] = f"error_{type(exc).__name__}"
            row["dcf_reason"] = str(exc)[:300]
    return rows


def report(rows) -> str:
    operating = [r for r in rows if r.get("fv_status") != "not_an_operating_company"]
    valued = [r for r in operating if r.get("fv_status") == "valued"]
    dcf_valued = [r for r in operating if r.get("dcf_status") == "valued"]
    out = [f"# Fair value audit ({date.today().isoformat()})", "",
           "Generated by `scripts/audit_fair_value.py` on a copy of the local database (stage 0 of",
           "`docs/superpowers/specs/2026-11-01-fair-value-refusal-outlier-plan.md`). Nothing here changes a",
           "valuation; it measures the current rules.", "",
           f"Watchlist tickers: {len(rows)}; operating companies: {len(operating)}; not operating companies "
           f"(ETFs and the like, correctly never valued): {len(rows) - len(operating)}.", ""]

    def status_table(title, key, total):
        out.extend([f"## {title}", "", "| Status | Tickers | Share |", "|---|---|---|"])
        for status, count in Counter(r.get(key) for r in operating).most_common():
            out.append(f"| `{status}` | {count} | {count / total * 100:.0f}% |")
        out.append("")

    status_table("Damodaran fair value: valued or refused", "fv_status", len(operating))
    status_table("Corporate tab 5-year DCF: valued or refused", "dcf_status", len(operating))

    def dist(title, values, note=""):
        q = _quantiles(values)
        out.extend([f"### {title}", ""])
        if note:
            out.extend([note, ""])
        if q is None:
            out.extend(["Too few values.", ""])
            return
        out.extend(["| n | p10 | p25 | median | p75 | p90 |", "|---|---|---|---|---|---|",
                    f"| {q['n']} | {_fmt(q['p10'])} | {_fmt(q['p25'])} | {_fmt(q['p50'])} | {_fmt(q['p75'])} | {_fmt(q['p90'])} |", ""])
        bands = [(">= 3x", lambda v: v >= 3), ("2x-3x", lambda v: 2 <= v < 3), ("0.5x-2x", lambda v: 0.5 <= v < 2),
                 ("< 0.5x", lambda v: v < 0.5)]
        clean = [v for v in values if v is not None]
        out.append(" · ".join(f"{label}: {sum(1 for v in clean if test(v))}" for label, test in bands))
        out.append("")

    out.extend(["## How large", ""])
    dist("Fair value ÷ last close", [r.get("fv_to_price") for r in valued])
    dist("Implied EV/Sales ÷ industry EV/Sales", [r.get("ev_sales_vs_industry") for r in valued],
         "The candidate for the plan's plausibility flag (stage 1, threshold k). Industry EV/Sales is "
         "Damodaran's US average for the ticker's own industry.")
    dist("Market EV/Sales ÷ industry EV/Sales", [_ratio(r.get("market_ev_sales"), r.get("ind_ev_sales")) for r in valued],
         "For comparison: how far the MARKET already prices these companies above their industry. A flag "
         "threshold below this spread would fire on the market itself.")
    dist("5-year DCF ÷ last close", [r.get("dcf_to_price") for r in dcf_valued])

    cols = ["ticker", "industry", "fv_to_price", "ev_sales_vs_industry", "growth_10y_cagr", "base_margin",
            "margin_target", "ind_margin", "s2c", "ind_s2c", "wacc_initial", "wacc_stable", "roic_stable", "terminal_share"]
    header = ("| Ticker | Industry | FV÷price | EV/S÷ind | Growth 10y | Margin now | Margin target | Ind. margin | "
              "S/C | Ind. S/C | WACC start | WACC stable | ROIC stable | TV share |")

    def table(title, picked):
        out.extend([f"### {title}", "", header, "|" + "---|" * len(cols)])
        for r in picked:
            out.append("| " + " | ".join([
                r["ticker"], r.get("industry", ""), _fmt(r.get("fv_to_price")), _fmt(r.get("ev_sales_vs_industry")),
                _pct(r.get("growth_10y_cagr")), _pct(r.get("base_margin")), _pct(r.get("margin_target")),
                _pct(r.get("ind_margin")), _fmt(r.get("s2c")), _fmt(r.get("ind_s2c")), _pct(r.get("wacc_initial")),
                _pct(r.get("wacc_stable")), _pct(r.get("roic_stable")), _pct(r.get("terminal_share")),
            ]) + " |")
        out.append("")

    by_ratio = sorted((r for r in valued if r.get("fv_to_price") is not None), key=lambda r: r["fv_to_price"])
    out.extend(["## Where the large values come from", ""])
    table("Largest fair value ÷ price (top 15)", list(reversed(by_ratio))[:15])
    table("Smallest fair value ÷ price (bottom 10)", by_ratio[:10])

    out.extend(["## Refusal reasons, one example each", "", "| Code | Example ticker | Reason |", "|---|---|---|"])
    seen = set()
    for r in operating:
        code = r.get("fv_status")
        if code and code != "valued" and code not in seen:
            seen.add(code)
            out.append(f"| `{code}` | {r['ticker']} | {(r.get('fv_reason') or '').replace('|', '/')} |")
    out.extend(["", "## Not measured", "",
                "- P/E: no trailing EPS or net income is stored per ticker, so the implied P/E against the industry's "
                "Trailing PE is not computed here. EV/Sales covers every company that has revenue.", ""])
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", type=Path, help="a COPY of the database to use (default: a fresh temporary copy)")
    parser.add_argument("--out", type=Path, help="write the markdown report here (default: stdout)")
    parser.add_argument("--csv", type=Path, help="also write one row per ticker here")
    args = parser.parse_args()

    if args.db is not None and args.db.resolve() == REAL_DB.resolve():
        print("refusing to run on the real database; pass a copy", file=sys.stderr)
        return 2
    temp_dir = None
    if args.db is None:
        temp_dir = tempfile.mkdtemp(prefix="mv-fv-audit-")
        db_path = Path(temp_dir) / "moneyview.db"
        shutil.copy2(REAL_DB, db_path)
    else:
        db_path = args.db

    os.environ.setdefault("MONEYVIEW_DISABLE_STARTUP_JOBS", "1")
    sys.path.insert(0, str(REPO))
    from apps.api.services import db as db_service

    db_service._DB_PATH = db_path
    try:
        with db_service.get_db() as conn:
            types = dict(conn.execute("SELECT ticker, instrument_type FROM corporate_quote_facts").fetchall())
            tickers = [r[0] for r in conn.execute("SELECT ticker FROM watchlist ORDER BY ticker")]
        rows = measure([(t, types.get(t)) for t in tickers])
        text = report(rows)
        if args.out:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(text, encoding="utf-8")
        else:
            print(text)
        if args.csv:
            keys = sorted({k for r in rows for k in r})
            with args.csv.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=keys)
                writer.writeheader()
                writer.writerows(rows)
    finally:
        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
