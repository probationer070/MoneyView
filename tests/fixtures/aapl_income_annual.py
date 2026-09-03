"""Real Yahoo annual-income rows for AAPL, fetched and persisted 2026-09-03.

Track A2 (`guideline/sop/todo.md`) could not wire the trailing-PE row's EPS
read until Yahoo's exact line-item label text was confirmed against a real
stored bundle -- guessing them was ruled worse than refusing (the
`eps_not_wired` reason `valuation_verdict.py` carried before this fixture
existed). These four labels, and all five period columns including the
all-NaN one, are what `load_statement_bundle("AAPL")["income"]` actually
returned. THE LABELS ARE THE POINT of this fixture, not the numbers: any
caller matching against `"Diluted EPS"`, `"Basic EPS"`, `"Net Income"` or
`"Diluted Average Shares"` is matching text Yahoo actually reports.

2021-09-30 is intentionally all-`None` (Yahoo's own bundle carries no figures
for that period at all) so a caller reading "the newest period with an
EPS" has a real NaN period to skip rather than a synthetic one.
"""

import pandas as pd

AAPL_INCOME_ANNUAL = pd.DataFrame(
    {
        "2025-09-30": [7.46, 7.49, 112010000000, 15004697000],
        "2024-09-30": [6.08, 6.11, 93736000000, 15408095000],
        "2023-09-30": [6.13, 6.16, 96995000000, 15812547000],
        "2022-09-30": [6.11, 6.15, 99803000000, 16325819000],
        "2021-09-30": [None, None, None, None],
    },
    index=["Diluted EPS", "Basic EPS", "Net Income", "Diluted Average Shares"],
)
AAPL_INCOME_ANNUAL.columns = pd.to_datetime(AAPL_INCOME_ANNUAL.columns)
