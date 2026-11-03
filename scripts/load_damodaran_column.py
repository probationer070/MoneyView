"""Load one Damodaran P/E column into an already-stored industry-benchmark vintage.

Manual loader, like `store_vintage`: nothing schedules it. It only UPDATEs rows that exist for
the vintage, so run `store_vintage` for the vintage first. Currently loads `aggregate_pe`, the
aggregate market cap over money-making-firm net income that the relative-pricing P/E row reads.

Usage (from the repo root):
    PYTHONPATH=. python scripts/load_damodaran_column.py --vintage 2026-01-01 \
        --path data/raw/damodaran/pedata-2026-01.xlsx
"""

from __future__ import annotations

import argparse

from apps.api.services.db import get_db
from apps.api.services.industry_benchmark_store import parse_pe_workbook, store_column
from packages.core_finance.industry_benchmark import column_by_key

_KEY = "aggregate_pe"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--vintage", required=True, help="stored vintage, e.g. 2026-01-01")
    parser.add_argument("--path", required=True, help="Damodaran P/E workbook (.xlsx)")
    args = parser.parse_args()

    values = parse_pe_workbook(args.path)
    updated, unmatched = store_column(args.vintage, _KEY, values)
    with get_db() as conn:
        still_null = [
            row["industry_name"]
            for row in conn.execute(
                f"SELECT industry_name FROM industry_benchmark "
                f"WHERE vintage = ? AND {_KEY} IS NULL ORDER BY industry_name",
                (args.vintage,),
            ).fetchall()
        ]
    print(f"{column_by_key(_KEY).source_header!r} -> {_KEY}, vintage {args.vintage}")
    print(f"rows updated: {updated}")
    print(f"workbook names with no stored row ({len(unmatched)}): {unmatched}")
    print(f"stored industries still NULL for {_KEY} ({len(still_null)}): {still_null}")


if __name__ == "__main__":
    main()
