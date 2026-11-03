# Fair value: would a longer company CAGR window help? (2026-11-03)

Measured with `scripts/audit_fair_value_cagr_window.py` on a temporary copy of `data/processed/moneyview.db`
(production code unchanged; the CAGR function and case name are wrapped inside the script only).

## Result: the question cannot be tested, the data holds at most 4 annual revenue points

The company CAGR is `company_revenue_cagr` (`apps/api/services/fair_value_case.py`, `CAGR_YEARS = 3`), fed by
`revenue_by_year` from the stored annual income statement (`corporate_statements`, source Yahoo). Yahoo returns
four fiscal years, and the oldest of the five stored rows is empty (NVDA: FY2022 = None; same for XOM).

| Annual revenue points usable per ticker | Tickers (of 252 operating names) |
|---|---|
| 4 (the full 3-year window) | 173 |
| 3 | 53 |
| 2 | 1 |
| 1 | 1 |
| 0 | 9 |
| 5, 7 or 10 | 0 |

So a 5-year or "longest available" window takes the same points as today for every ticker: the CAGR differs for
0 tickers, and all three variants give identical results.

| Variant | Valued | Refused | Median FV/price | >= 3x | < 0.5x (positive) | Semis group* median |
|---|---|---|---|---|---|---|
| Baseline (3y) | 186 | 66 | 0.81 | 12 | 61 | 0.26 (n=40) |
| 5y (all available) | 186 | 66 | 0.81 | 12 | 61 | 0.26 |
| Longest available (min 3) | 186 | 66 | 0.81 | 12 | 61 | 0.26 |

*Semiconductor, Semiconductor Equip, Computers/Peripherals. Biggest movers: none (0 tickers change in either
direction). Refusal codes are unchanged as well.

## Recommendation

Do not change `CAGR_YEARS`: raising it does nothing with the stored data. Spanning a full semiconductor cycle
(roughly 2018-2025) needs a different history source (for example SEC XBRL annual facts, or a paid fundamentals
feed) and a separate decision; only after that can the window be measured. Side effects of such a change cannot
be reported here. Expected direction, unmeasured: a longer window would lift cyclicals whose 2022-25 trough sits
inside the window and lower fast growers whose recent years are the strongest, and tickers with short history
(53 with only 3 points, 11 with less) would fall back to a shorter window than their peers.

## Could not measure

Any window longer than 3 years: the data is not stored. No 10-year or cycle-spanning figure exists in this repo.
