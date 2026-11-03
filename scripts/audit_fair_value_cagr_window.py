"""What-if: a longer company revenue CAGR window for the Damodaran fair value.

Variants: base (3y, current rule), 5y (last 6 points, or all that exist), max (every stored point, at
least the base window). Only the CAGR function that `fair_value` calls is wrapped, inside this script;
cases are stored in a COPY of the database under a per-variant name suffix. Nothing is fetched and the
real database is never written.

usage: python scripts/audit_fair_value_cagr_window.py [--db COPY] [--json OUT.json]
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

from audit_fair_value import NOT_OPERATING, REAL_DB, _code, _ratio  # noqa: E402

VARIANTS = ("base", "y5", "max")
WINDOW = {"base": 3, "y5": 5, "max": None}


def _cagr(rev: dict, window):
    years = sorted(rev)
    years = years if window is None else years[-(window + 1):]
    if window is None and len(years) < 4:
        years = sorted(rev)[-4:]
    if len(years) < 2:
        return None
    s, e = float(rev[years[0]]), float(rev[years[-1]])
    if s <= 0 or e <= 0:
        return None
    return (e / s) ** (1.0 / (years[-1] - years[0])) - 1.0


def run(variant, pairs, cov):
    from apps.api.services import fair_value as fv
    from apps.api.services.acquisition.store import load_price_bars
    from apps.api.services.industry_benchmark_store import industry_row_for_ticker
    from apps.api.services.valuation_case import run_stored_case

    orig_cagr, orig_name = fv.company_revenue_cagr, fv.fair_value_case_name
    cur = {"t": None}

    def cagr(rev):
        if variant == "base":
            cov[cur["t"]] = {"points": len(rev), "span": (max(rev) - min(rev)) if rev else 0}
        g = _cagr(rev, WINDOW[variant])
        cov.setdefault(cur["t"], {})[f"cagr_{variant}"] = g
        return g

    orig_build = fv.build_fair_value_case

    def build(*a, **k):
        payload = orig_build(*a, **k)
        payload["case_name"] = f"{payload['case_name']}_cw{variant}"
        return payload

    fv.company_revenue_cagr, fv.build_fair_value_case = cagr, build
    fv.fair_value_case_name = lambda *a, **k: f"{orig_name(*a, **k)}_cw{variant}"
    out = {}
    try:
        for t, kind in pairs:
            if (kind or "").lower() in NOT_OPERATING:
                continue
            cur["t"] = t
            row = out[t] = {"status": None}
            ind, _, _ = industry_row_for_ticker(t)
            row["industry"] = ind.name if ind is not None else "(none)"
            bars = [b for b in load_price_bars(t, limit=5) if b.get("close")]
            price = float(bars[-1]["close"]) if bars else None
            try:
                cid, _c, _v, reason = fv.generate_fair_value_case_for_ticker(t)
                if reason is not None:
                    row["status"], row["reason"] = _code(reason), reason
                    continue
                v = run_stored_case(cid)["value_per_share_diluted"]
                row.update(status="valued", value=v, ratio=_ratio(v, price))
            except Exception as exc:  # noqa: BLE001
                row["status"], row["reason"] = f"error_{type(exc).__name__}", str(exc)[:200]
    finally:
        fv.company_revenue_cagr, fv.fair_value_case_name, fv.build_fair_value_case = orig_cagr, orig_name, orig_build
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path)
    ap.add_argument("--json", type=Path)
    a = ap.parse_args()
    if a.db is not None and a.db.resolve() == REAL_DB.resolve():
        print("refusing the real database", file=sys.stderr)
        return 2
    tmp = None
    if a.db is None:
        tmp = tempfile.mkdtemp(prefix="mv-fv-cw-")
        db_path = Path(tmp) / "moneyview.db"
        shutil.copy2(REAL_DB, db_path)
    else:
        db_path = a.db
    os.environ.setdefault("MONEYVIEW_DISABLE_STARTUP_JOBS", "1")
    from apps.api.services import db as dbs

    dbs._DB_PATH = db_path
    try:
        with dbs.get_db() as conn:
            types = dict(conn.execute("SELECT ticker, instrument_type FROM corporate_quote_facts").fetchall())
            tickers = [r[0] for r in conn.execute("SELECT ticker FROM watchlist ORDER BY ticker")]
        pairs = [(t, types.get(t)) for t in tickers]
        cov, res = {}, {}
        for v in VARIANTS:
            print("variant", v, file=sys.stderr)
            res[v] = run(v, pairs, cov)
        if a.json:
            a.json.write_text(json.dumps({"res": res, "cov": cov}), encoding="utf-8")
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
