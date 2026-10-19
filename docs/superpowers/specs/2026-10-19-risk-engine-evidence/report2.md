# Risk-alert threshold backtest (risk-signal sub-project 2, first task)

Research output. Nothing in the repo was changed. Window 2016-01-04 .. 2026-10-16
(10.78 years), 22 trigger themes, 345 big drawdown episodes.

## Recommendation

**X = 4%, Y = 1 day, K = 3 warnings, release rule B (per-theme exit), warning thresholds as in the brief.**

- Fires on 2026-10-08 for all five semiconductor themes (and ^SOX). No semis banner test on 10/01-10/02;
  memory_storage passed on 10/06, the others joined on 10/08.
- 3.43 alerts/year (37 alerts). The banner is up on 37% of trading days.
  About 135 theme confirmations/year feed those alerts.
- Useful share: 30% of alerts (a triggering theme fell a further >= 5% within 10 days),
  36% per theme confirmation. The unconditional rate on any theme-day is 25%.
- Episodes caught before half the drawdown: **100/345 (29%)**.
  Deep (>= 25%) episodes 33/134. ^SOX episodes 5/14. The median caught episode was flagged
  7 trading days before its half-way point.
- Known blind spots at K = 3: on ^SOX it misses Feb-Mar 2020 (COVID, -35%), Jan-Apr 2025 (tariffs, -35%),
  Jul-Aug 2024 (-25%) and Jun-Jul 2026 (-29%). Too few macro warnings were on then.

**What it costs, and why not more recall.** The owner chose sensitivity (R-D12), so selection is "highest
recall", subject to one limit: the banner may be up on at most 50% of trading days. Without that limit,
the grid's recall winner is K = 0, and at K = 0 the banner is up on 94-99% of days. At K <= 2 (accepted settings) it is up on
64-99% of days under either release rule. A banner that is almost always on cannot say "a risk signal was
caught" (R-D2). The step from K = 3 to K = 2 is the one real choice. At X4/Y1, K = 2 gives recall
61% (210/345) and 4.08 alerts/year, but the banner is up on 80%
of days. If the owner prefers that, the only change is K = 2.

**Release rule.** The brief's rule A (release only when every alert theme has recovered, or no alert theme
has made a new 20-day low for 15 days) rarely releases once many themes have joined. At the recommended
X/Y/K, rule A gives 2.6 alerts/year, but the banner is up on 51% of days and the longest alert lasts
444 trading days. In 2026 one rule-A alert opened on 2026-03-27 and was still open on 10/08, with every
semis theme inside it since March. That breaks R-D11 ("not 10/02"). Rule B applies the same two tests to
each theme separately. A theme that recovers, or makes no new low for 15 days, leaves the alert, and the
alert is released when no theme is left. Under rule B the 2026 alert opened on 2026-09-16 (financials_payments, with
W2, W3, W6 on), and semis joined on 10/06-10/08. Rule B is recommended. The `rules.yaml` entry should
encode the per-theme exit.

## Data and method (what was actually used)

- **Prices.** Local DB `stocks.close` for the 250 watchlist tickers. It is split-adjusted: NVDA and AVGO are
  smooth across their 2024-06-10 and 2024-07-15 10:1 splits, and DB daily returns match yfinance on all but
  a handful of days. The DB starts 2016-09-06/2016-10-18 for most tickers, and 141 tickers stop at 2026-09-29.
  Both ends were extended with yfinance auto-adjusted closes, rescaled to meet the DB close, so the window
  starts in 2016-01. PSTG has no yfinance data and stops at 2026-05-20.
  ^SOX, RSP and SPY come from one yfinance batch.
- **Theme index.** Cap-weighted and chain-linked. The day-t return is the sum of w_i*r_i over the sum of
  w_i, with w_i = shares_now_i x close_i,t-1, over members with closes on t-1 and t. A member that enters or
  leaves changes the weights, not the level. Shares come from `corporate_quote_facts` (136 tickers) or
  yfinance `fast_info` (113). **shares_now x past close only approximates past market caps (R-D18)**:
  buybacks, issuance and IPO dilution are ignored. A theme is skipped on days with < 3 members (R-B5).
  `quantum` has only 2 members, so it never gets an index. `defensives_other` has an index but never
  triggers (R-D17).
- **W1 HY spread: what was used.** FRED serves `BAMLH0A0HYM2` only from **2023-10-17**. The series notes say
  "Starting in April 2026, this series will only include 3 years of observations" (ICE licence). ALFRED has
  no vintages for it (HTTP 400 "does not exist in ALFRED"), so earlier history cannot be recovered from FRED.
  W1 therefore uses the real HY OAS from 2023-10-17 on (738 evaluation days) and a **Moody's BAA10Y proxy before
  that** (1975 days). The proxy was calibrated on the overlap 2023-10-17..2026-10. BAA10Y was compared
  with log(HYG/IEF). Both have a 10-day-change correlation of 0.69 with HY. With a regression beta, 23 of the
  24 days BAA10Y flagged were real HY flag days, against 15 of 18 for HYG/IEF, so BAA10Y was used.
  - Velocity arm: BAA10Y up >= 0.10 pp in 10 trading days. The threshold is set by frequency matching,
    so it is on as often (5.7% of overlap days) as "HY up >= 0.30 pp".
  - Level arm: HY = 0.68 + 1.48 x BAA10Y (overlap OLS), so HY 3.50 corresponds to BAA10Y >= 1.91.
  - Consequence: in the proxy era the level arm is on almost all the time. W1 is on 100% of days in 2016,
    2019 and 2020 and 90% in 2022, against 5-16% in 2024-2026 on real data. Real HY OAS was also mostly
    above 3.50 in 2016-2020, so this is roughly right. But it means W1 counts as a free warning before 2023.
- **Other warnings.** FRED daily values are used from the next business day (lag 1). Brent's real EIA lag is
  longer; this was ignored. Core CPI for month M is known from the 15th of M+1; core PCE from the end of M+1.
  W4 uses DFEDTARU change dates; those are effective dates, which are never before the decision day.
  W6 uses the theme's 5 largest members by shares_now x close that day. W7 is market-wide.
- **Confirmation.** dd20 <= -X%, >= Y consecutive down closes, and warnings on >= K. The warning count is
  W1-W5 + W7 (market-wide) + W6 for that theme. The five semis themes also accept the same price test on ^SOX.
- **Outcome.** Forward returns are measured from the day each theme joined. "Useful" = a triggering theme's
  minimum close over the next 10 days is <= -5%. The primary theme (deepest dd20 among the triggers) supplies
  fwd 5/10/20 in the tables.
- **Episodes and recall.** Per theme, peak-to-trough >= 15% within <= 60 trading days, with the scan resuming
  after each trough. An episode is caught when that theme's own banner test fires on a day between the peak
  and the half-drawdown day. On that day an alert including the theme is necessarily up: it opens, the theme
  joins, or the theme is already in it. This measure does not depend on the release rule. Measuring recall by
  alert membership instead would credit the near-permanent alerts at low K with almost 100% recall.

## Acceptance check: does the setting fire on 2026-10-08 (semis)?

State on 10/08: W1 True (HY 3.09, 10-day change +0.36), W2 True (DGS10 5.28),
W3 True (Brent +15.1% over 20 days), W4 True (9/17 hike), W5 False (known core CPI
0.29%, i.e. August; the September +0.33% core print came out 10/15), W7 False. W6 is on for
ai_semis, power_producers, software_internet. So 4 market warnings are on, plus W6 for ai_semis. ^SOX dd20 -4.5% with 2 down
days. Semis themes dd20: ai_semis -4.3%, analog_power_chips -4.4%, chip_equipment_design -5.5%, memory_storage -8.1%, optical_connectivity -7.8%.

A setting is dropped if no semis theme passes on 10/08, or if a semis theme already passes on 10/01-10/02
(R-D11). Every setting with X = 6 and Y = 3 fails. Settings with X = 3 and Y = 1 fire on 10/01-10/02.
X = 5-6 pass only because memory_storage, optical_connectivity and chip_equipment_design are down more
than ^SOX (-4.5%), so they are fragile. X <= 4 with Y <= 2 passes on ^SOX itself. Y = 3 passes only
through chip_equipment_design (4 down days), because ^SOX had 2.

| setting | fires 10/08 | semis themes passing 10/08 | semis test days 10/01-10/07 | on 10/01-02 | result |
|---|---|---|---|---|---|
| X3 Y1 K0 | yes | ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | 2026-10-02, 2026-10-06, 2026-10-07 | **yes** | dropped |
| X3 Y1 K1 | yes | ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | 2026-10-02, 2026-10-06, 2026-10-07 | **yes** | dropped |
| X3 Y1 K2 | yes | ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | 2026-10-02, 2026-10-06, 2026-10-07 | **yes** | dropped |
| X3 Y1 K3 | yes | ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | 2026-10-02, 2026-10-06, 2026-10-07 | **yes** | dropped |
| X3 Y2 K0 | yes | ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | 2026-10-07 | no | kept |
| X3 Y2 K1 | yes | ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | 2026-10-07 | no | kept |
| X3 Y2 K2 | yes | ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | 2026-10-07 | no | kept |
| X3 Y2 K3 | yes | ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | 2026-10-07 | no | kept |
| X3 Y3 K0 | yes | chip_equipment_design | 2026-10-07 | no | kept |
| X3 Y3 K1 | yes | chip_equipment_design | 2026-10-07 | no | kept |
| X3 Y3 K2 | yes | chip_equipment_design | 2026-10-07 | no | kept |
| X3 Y3 K3 | yes | chip_equipment_design | 2026-10-07 | no | kept |
| X4 Y1 K0 | yes | ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | 2026-10-06 | no | kept |
| X4 Y1 K1 | yes | ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | 2026-10-06 | no | kept |
| X4 Y1 K2 | yes | ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | 2026-10-06 | no | kept |
| X4 Y1 K3 | yes | ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | 2026-10-06 | no | kept |
| X4 Y2 K0 | yes | ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | - | no | kept |
| X4 Y2 K1 | yes | ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | - | no | kept |
| X4 Y2 K2 | yes | ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | - | no | kept |
| X4 Y2 K3 | yes | ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | - | no | kept |
| X4 Y3 K0 | yes | chip_equipment_design | - | no | kept |
| X4 Y3 K1 | yes | chip_equipment_design | - | no | kept |
| X4 Y3 K2 | yes | chip_equipment_design | - | no | kept |
| X4 Y3 K3 | yes | chip_equipment_design | - | no | kept |
| X5 Y1 K0 | yes | chip_equipment_design, memory_storage, optical_connectivity | 2026-10-06 | no | kept |
| X5 Y1 K1 | yes | chip_equipment_design, memory_storage, optical_connectivity | 2026-10-06 | no | kept |
| X5 Y1 K2 | yes | chip_equipment_design, memory_storage, optical_connectivity | 2026-10-06 | no | kept |
| X5 Y1 K3 | yes | chip_equipment_design, memory_storage, optical_connectivity | 2026-10-06 | no | kept |
| X5 Y2 K0 | yes | chip_equipment_design, optical_connectivity | - | no | kept |
| X5 Y2 K1 | yes | chip_equipment_design, optical_connectivity | - | no | kept |
| X5 Y2 K2 | yes | chip_equipment_design, optical_connectivity | - | no | kept |
| X5 Y2 K3 | yes | chip_equipment_design, optical_connectivity | - | no | kept |
| X5 Y3 K0 | yes | chip_equipment_design | - | no | kept |
| X5 Y3 K1 | yes | chip_equipment_design | - | no | kept |
| X5 Y3 K2 | yes | chip_equipment_design | - | no | kept |
| X5 Y3 K3 | yes | chip_equipment_design | - | no | kept |
| X6 Y1 K0 | yes | memory_storage, optical_connectivity | 2026-10-06 | no | kept |
| X6 Y1 K1 | yes | memory_storage, optical_connectivity | 2026-10-06 | no | kept |
| X6 Y1 K2 | yes | memory_storage, optical_connectivity | 2026-10-06 | no | kept |
| X6 Y1 K3 | yes | memory_storage, optical_connectivity | 2026-10-06 | no | kept |
| X6 Y2 K0 | yes | optical_connectivity | - | no | kept |
| X6 Y2 K1 | yes | optical_connectivity | - | no | kept |
| X6 Y2 K2 | yes | optical_connectivity | - | no | kept |
| X6 Y2 K3 | yes | optical_connectivity | - | no | kept |
| X6 Y3 K0 | **no** | - | - | no | dropped |
| X6 Y3 K1 | **no** | - | - | no | dropped |
| X6 Y3 K2 | **no** | - | - | no | dropped |
| X6 Y3 K3 | **no** | - | - | no | dropped |

## Surviving grid

"alerts/yr B" and "banner days B" use the recommended rule B. The rule A columns use the brief's rule. Useful
(alert) is per alert. Useful (signal) is per theme confirmation run; the base rate is 25%. Median fwd10
is the primary theme's return over the next 10 days. Recall columns: all episodes, >= 25% episodes, ^SOX episodes.

| setting | alerts/yr B | alerts/yr A | banner days B | banner days A | useful (alert) | useful (signal) | confirmations/yr | median fwd10 | episodes caught | >=25% | ^SOX |  |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| X3 Y2 K0 | 2.13 | 1.95 | 99% | 99% | 17% | 30% | 467.1 | +4.31% | 337/345 (98%) | 133/134 | 14/14 |  |
| X3 Y2 K1 | 3.62 | 2.32 | 97% | 99% | 23% | 30% | 418.6 | +4.08% | 304/345 (88%) | 121/134 | 14/14 |  |
| X3 Y2 K2 | 4.73 | 3.06 | 79% | 86% | 37% | 30% | 238.3 | +0.89% | 202/345 (59%) | 70/134 | 9/14 |  |
| X3 Y2 K3 | 3.71 | 2.97 | 39% | 53% | 35% | 36% | 97.1 | +2.18% | 99/345 (29%) | 32/134 | 6/14 |  |
| X3 Y3 K0 | 4.27 | 2.5 | 96% | 98% | 24% | 29% | 252.0 | +2.17% | 289/345 (84%) | 120/134 | 13/14 |  |
| X3 Y3 K1 | 4.92 | 2.69 | 92% | 95% | 28% | 29% | 227.7 | +1.86% | 261/345 (76%) | 109/134 | 12/14 |  |
| X3 Y3 K2 | 5.75 | 3.15 | 74% | 82% | 29% | 27% | 129.2 | +0.86% | 159/345 (46%) | 62/134 | 8/14 |  |
| X3 Y3 K3 | 2.97 | 2.5 | 32% | 43% | 44% | 30% | 52.8 | -0.03% | 74/345 (21%) | 30/134 | 5/14 |  |
| X4 Y1 K0 | 1.67 | 1.86 | 99% | 99% | 33% | 32% | 686.9 | +7.09% | 344/345 (100%) | 133/134 | 14/14 |  |
| X4 Y1 K1 | 2.6 | 2.23 | 98% | 98% | 36% | 31% | 610.5 | +4.95% | 314/345 (91%) | 122/134 | 14/14 |  |
| X4 Y1 K2 | 4.08 | 2.5 | 80% | 86% | 55% | 31% | 338.6 | +3.01% | 210/345 (61%) | 75/134 | 9/14 |  |
| X4 Y1 K3 | 3.43 | 2.6 | 37% | 51% | 30% | 36% | 135.0 | +2.24% | 100/345 (29%) | 33/134 | 5/14 | **rec** |
| X4 Y2 K0 | 2.13 | 2.13 | 98% | 99% | 30% | 32% | 402.2 | +5.85% | 336/345 (97%) | 133/134 | 14/14 |  |
| X4 Y2 K1 | 3.34 | 2.32 | 96% | 98% | 36% | 31% | 358.1 | +4.68% | 303/345 (88%) | 121/134 | 14/14 |  |
| X4 Y2 K2 | 3.71 | 2.5 | 76% | 83% | 48% | 32% | 203.0 | +2.57% | 194/345 (56%) | 70/134 | 8/14 |  |
| X4 Y2 K3 | 2.5 | 2.04 | 33% | 44% | 41% | 38% | 83.3 | +2.13% | 94/345 (27%) | 31/134 | 5/14 |  |
| X4 Y3 K0 | 3.43 | 2.41 | 95% | 97% | 27% | 31% | 223.7 | +3.90% | 289/345 (84%) | 120/134 | 13/14 |  |
| X4 Y3 K1 | 4.17 | 2.41 | 90% | 94% | 31% | 30% | 201.4 | +1.16% | 261/345 (76%) | 109/134 | 12/14 |  |
| X4 Y3 K2 | 4.54 | 2.6 | 72% | 80% | 33% | 28% | 115.0 | +0.58% | 155/345 (45%) | 62/134 | 8/14 |  |
| X4 Y3 K3 | 2.32 | 2.04 | 28% | 38% | 44% | 31% | 47.9 | +1.63% | 72/345 (21%) | 29/134 | 4/14 |  |
| X5 Y1 K0 | 2.23 | 1.95 | 98% | 98% | 42% | 33% | 586.4 | +5.25% | 344/345 (100%) | 133/134 | 14/14 |  |
| X5 Y1 K1 | 3.15 | 2.04 | 95% | 97% | 47% | 32% | 518.1 | +2.02% | 305/345 (88%) | 118/134 | 14/14 |  |
| X5 Y1 K2 | 3.15 | 1.86 | 72% | 79% | 47% | 33% | 284.0 | +2.57% | 195/345 (56%) | 71/134 | 9/14 |  |
| X5 Y1 K3 | 1.86 | 1.39 | 31% | 45% | 50% | 39% | 114.4 | +0.53% | 95/345 (28%) | 33/134 | 4/14 |  |
| X5 Y2 K0 | 2.88 | 2.23 | 97% | 98% | 45% | 33% | 347.2 | +3.83% | 335/345 (97%) | 133/134 | 14/14 |  |
| X5 Y2 K1 | 3.9 | 2.13 | 93% | 96% | 45% | 32% | 307.2 | +0.36% | 297/345 (86%) | 118/134 | 14/14 |  |
| X5 Y2 K2 | 3.34 | 1.86 | 69% | 77% | 36% | 32% | 173.0 | +2.57% | 183/345 (53%) | 68/134 | 8/14 |  |
| X5 Y2 K3 | 1.76 | 1.67 | 28% | 37% | 42% | 40% | 71.9 | +1.63% | 92/345 (27%) | 31/134 | 4/14 |  |
| X5 Y3 K0 | 3.99 | 2.41 | 94% | 96% | 33% | 31% | 198.0 | +0.58% | 285/345 (83%) | 120/134 | 13/14 |  |
| X5 Y3 K1 | 4.54 | 2.32 | 88% | 94% | 33% | 31% | 177.7 | +0.16% | 256/345 (74%) | 108/134 | 12/14 |  |
| X5 Y3 K2 | 3.9 | 2.23 | 64% | 76% | 24% | 29% | 100.5 | +1.52% | 148/345 (43%) | 60/134 | 8/14 |  |
| X5 Y3 K3 | 1.48 | 1.48 | 24% | 34% | 38% | 32% | 42.3 | +2.03% | 68/345 (20%) | 28/134 | 4/14 |  |
| X6 Y1 K0 | 2.88 | 1.95 | 96% | 98% | 42% | 34% | 498.6 | +2.41% | 344/345 (100%) | 133/134 | 14/14 |  |
| X6 Y1 K1 | 3.34 | 1.86 | 93% | 96% | 50% | 34% | 439.9 | -0.03% | 301/345 (87%) | 118/134 | 14/14 |  |
| X6 Y1 K2 | 3.34 | 1.86 | 70% | 78% | 50% | 34% | 243.1 | +2.36% | 191/345 (55%) | 71/134 | 8/14 |  |
| X6 Y1 K3 | 1.58 | 1.02 | 29% | 43% | 53% | 40% | 99.7 | +1.12% | 90/345 (26%) | 33/134 | 4/14 |  |
| X6 Y2 K0 | 3.43 | 1.86 | 95% | 97% | 38% | 34% | 298.8 | +2.16% | 332/345 (96%) | 133/134 | 14/14 |  |
| X6 Y2 K1 | 3.99 | 1.86 | 91% | 96% | 40% | 33% | 264.4 | +0.68% | 292/345 (85%) | 118/134 | 14/14 |  |
| X6 Y2 K2 | 3.43 | 1.76 | 66% | 76% | 40% | 33% | 149.3 | +2.24% | 175/345 (51%) | 67/134 | 8/14 |  |
| X6 Y2 K3 | 1.48 | 1.39 | 27% | 35% | 50% | 42% | 62.3 | +1.37% | 87/345 (25%) | 31/134 | 4/14 |  |

Reading: K drives almost everything. X and Y change recall by a few points within a K level. Median forward
10-day returns are positive for most settings: the average alert is followed by a rebound, and only about
1 in 3 alerts is followed by a further >= 5% fall. Per theme confirmation, the rate is 27-42% against the unconditional 25%. The value
of an alert is catching the big ones early, not timing the bottom.

## Recommended setting: alerts by year

| year | alerts |
|---|---|
| 2016 | 5 |
| 2017 | 3 |
| 2018 | 4 |
| 2019 | 3 |
| 2020 | 6 |
| 2021 | 6 |
| 2022 | 3 |
| 2023 | 1 |
| 2024 | 1 |
| 2025 | 2 |
| 2026 | 3 |

2026 runs to 10-16, and the last alert is still open. 2016-2023 W1 uses the BAA10Y proxy.

## Recommended setting: every alert (backfill for the past-alert record, R-D8)

Label these "과거 데이터로 계산", parameter version X4/Y1/K3/rule B. Forward returns are for the primary theme,
measured from the alert start. Per-theme values for every joined theme are in `results.json` ->
`recommended_alerts[].per`.

| # | start | release | days | trigger themes | joined later | warnings on at start | primary | fwd5 | fwd10 | fwd20 | max dd 10d | useful |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2016-03-10 | 2016-03-14 | 3 | space_comms | - | W1, W3, W6 | space_comms | 3.5% | 2.0% | 7.0% | -0.0% | no |
| 2 | 2016-03-15 | 2016-03-17 | 3 | space_comms | - | W1, W3, W6 | space_comms | 4.3% | 2.7% | 8.8% | -0.3% | no |
| 3 | 2016-03-23 | 2016-03-30 | 5 | nuclear_uranium | - | W1, W3, W6 | nuclear_uranium | 2.4% | -2.1% | 2.7% | -2.1% | no |
| 4 | 2016-05-02 | 2016-05-20 | 15 | ai_servers_network | - | W1, W3, W6 | ai_servers_network | -3.1% | -1.6% | 6.7% | -4.2% | no |
| 5 | 2016-12-02 | 2017-02-13 | 49 | ai_servers_network, cybersecurity, software_internet | gold_silver, regulated_utilities, space_comms, battery_rare_earth, copper_metals, optical_connectivity, nuclear_uranium | W1, W2, W3 | cybersecurity | 4.0% | 2.1% | 1.2% | 0.0% | no |
| 6 | 2017-04-03 | 2017-05-05 | 24 | optical_connectivity | ai_semis, power_equipment | W1, W4, W6 | optical_connectivity | -5.8% | -6.6% | -8.9% | -9.1% | yes |
| 7 | 2017-06-19 | 2017-07-18 | 21 | battery_rare_earth, gold_silver | optical_connectivity, regulated_utilities | W1, W4, W7 | gold_silver | 3.1% | -2.3% | 1.0% | -2.3% | no |
| 8 | 2017-07-25 | 2017-09-11 | 34 | memory_storage | cybersecurity, space_comms, chip_equipment_design, power_equipment, optical_connectivity, battery_rare_earth | W1, W4, W6, W7 | memory_storage | -5.5% | -6.6% | -3.2% | -8.0% | yes |
| 9 | 2018-01-16 | 2018-01-19 | 4 | nuclear_uranium | - | W4, W6, W7 | nuclear_uranium | 4.8% | 1.3% | -3.0% | 0.0% | no |
| 10 | 2018-03-22 | 2018-04-11 | 14 | optical_connectivity | - | W4, W5, W6 | optical_connectivity | -6.1% | -7.7% | -3.8% | -8.8% | yes |
| 11 | 2018-07-11 | 2018-07-12 | 2 | optical_connectivity, power_equipment | - | W1, W4, W6 | power_equipment | 2.0% | 3.6% | 8.8% | 0.0% | no |
| 12 | 2018-11-09 | 2018-11-16 | 6 | gold_silver | space_comms | W1, W4, W6 | gold_silver | 2.2% | 1.4% | 6.7% | -2.6% | no |
| 13 | 2019-01-23 | 2019-01-25 | 3 | nuclear_uranium, optical_connectivity | copper_metals | W1, W3, W4 | optical_connectivity | 3.2% | 8.7% | 13.9% | 0.0% | no |
| 14 | 2019-01-29 | 2019-01-30 | 2 | ai_semis, big_tech | - | W1, W3, W4 | ai_semis | 6.9% | 8.2% | 11.3% | 0.0% | no |
| 15 | 2019-02-12 | 2019-02-15 | 4 | nuclear_uranium | - | W1, W4, W6 | nuclear_uranium | 1.6% | 1.7% | -0.8% | 0.0% | no |
| 16 | 2020-05-01 | 2020-05-04 | 2 | cybersecurity | - | W1, W3, W6 | cybersecurity | 11.2% | 14.1% | 30.1% | 0.0% | no |
| 17 | 2020-05-12 | 2020-05-14 | 3 | optical_connectivity | - | W1, W3, W6 | optical_connectivity | 1.8% | 6.6% | 12.4% | -5.8% | yes |
| 18 | 2020-05-27 | 2020-06-30 | 25 | cybersecurity, gold_silver | memory_storage, space_comms, power_producers | W1, W3, W7 | gold_silver | -3.8% | 1.1% | 2.2% | -5.4% | yes |
| 19 | 2020-08-11 | 2020-10-05 | 39 | nuclear_uranium | optical_connectivity, battery_rare_earth, ai_cloud_datacenter | W1, W6, W7 | nuclear_uranium | -0.4% | 2.6% | 1.5% | -0.7% | no |
| 20 | 2020-11-09 | 2020-11-17 | 7 | software_internet | - | W1, W6, W7 | software_internet | -0.2% | 4.9% | 15.2% | -3.5% | no |
| 21 | 2020-11-24 | 2020-12-16 | 16 | gold_silver | battery_rare_earth, software_internet | W1, W3, W7 | gold_silver | 6.9% | 6.3% | 7.3% | 0.0% | no |
| 22 | 2021-02-05 | 2021-02-09 | 3 | optical_connectivity | - | W1, W6, W7 | optical_connectivity | 4.7% | 2.3% | -12.3% | 0.0% | no |
| 23 | 2021-02-18 | 2021-08-09 | 120 | ai_cloud_datacenter | regulated_utilities, ai_semis, ai_servers_network, analog_power_chips, battery_rare_earth, big_tech, chip_equipment_design, cybersecurity, gold_silver, memory_storage, nuclear_uranium, optical_connectivity, power_equipment, software_internet, space_comms, copper_metals, defense_aerospace, oil_gas, power_producers, financials_payments, crypto | W1, W3, W6 | ai_cloud_datacenter | 0.9% | -0.5% | 2.8% | -1.4% | no |
| 24 | 2021-08-12 | 2021-09-10 | 21 | chip_equipment_design, crypto, gold_silver, memory_storage, nuclear_uranium | battery_rare_earth, copper_metals, cybersecurity, optical_connectivity, space_comms | W1, W5, W7 | memory_storage | -1.8% | 2.4% | 3.5% | -1.8% | yes |
| 25 | 2021-10-20 | 2021-10-25 | 4 | chip_equipment_design | - | W3, W5, W7 | chip_equipment_design | 2.2% | 8.4% | 14.8% | 0.0% | no |
| 26 | 2021-10-27 | 2021-11-05 | 8 | defense_aerospace | - | W5, W6, W7 | defense_aerospace | -0.1% | 2.2% | -0.7% | -0.6% | no |
| 27 | 2021-11-30 | 2021-12-10 | 9 | ai_cloud_datacenter | - | W1, W5, W6 | ai_cloud_datacenter | -0.9% | 3.8% | -2.9% | -3.5% | no |
| 28 | 2022-01-13 | 2022-01-14 | 2 | ai_semis | - | W3, W5, W6 | ai_semis | -10.2% | -13.8% | -11.0% | -15.7% | yes |
| 29 | 2022-01-19 | 2022-08-12 | 143 | ai_cloud_datacenter, ai_semis, ai_servers_network, analog_power_chips, battery_rare_earth, big_tech, chip_equipment_design, crypto, financials_payments, memory_storage, optical_connectivity, power_equipment, software_internet, space_comms | cybersecurity, nuclear_uranium, copper_metals, power_producers, regulated_utilities, defense_aerospace, gold_silver, oil_gas | W2, W3, W5 | crypto | -18.3% | -14.0% | -3.6% | -23.3% | yes |
| 30 | 2022-08-17 | 2023-11-20 | 318 | analog_power_chips, battery_rare_earth, crypto, memory_storage, nuclear_uranium | space_comms, ai_semis, chip_equipment_design, cybersecurity, gold_silver, optical_connectivity, power_equipment, software_internet, ai_cloud_datacenter, big_tech, defense_aerospace, financials_payments, ai_servers_network, copper_metals, oil_gas, regulated_utilities, power_producers | W1, W4, W5 | nuclear_uranium | 10.8% | 13.8% | 10.2% | -2.9% | yes |
| 31 | 2023-12-06 | 2023-12-07 | 2 | optical_connectivity | - | W1, W6, W7 | optical_connectivity | 7.6% | 10.1% | 7.0% | 0.0% | no |
| 32 | 2024-10-22 | 2024-12-09 | 34 | ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity, power_producers | cybersecurity, defense_aerospace, gold_silver, oil_gas, battery_rare_earth | W2, W5, W7 | chip_equipment_design | 3.3% | -0.1% | -3.8% | -1.6% | yes |
| 33 | 2025-06-20 | 2025-06-24 | 3 | nuclear_uranium | - | W3, W5, W6 | nuclear_uranium | 2.3% | 3.2% | 12.5% | -0.8% | no |
| 34 | 2025-10-14 | 2025-10-15 | 2 | memory_storage | - | W1, W5, W6 | memory_storage | 6.2% | 14.3% | 31.0% | 0.0% | no |
| 35 | 2026-02-06 | 2026-03-12 | 24 | big_tech | optical_connectivity, ai_servers_network | W1, W5, W7 | big_tech | -4.0% | -3.6% | -1.8% | -4.0% | no |
| 36 | 2026-03-27 | 2026-04-20 | 16 | ai_cloud_datacenter, ai_semis, ai_servers_network, analog_power_chips, big_tech, chip_equipment_design, crypto, cybersecurity, defense_aerospace, financials_payments, memory_storage, nuclear_uranium, optical_connectivity, power_equipment, software_internet, space_comms | copper_metals, gold_silver, power_producers | W2, W3, W5 | crypto | 4.1% | 8.2% | 25.5% | -2.3% | yes |
| 37 | 2026-09-16 | open | 23 | financials_payments | defense_aerospace, software_internet, gold_silver, oil_gas, regulated_utilities, ai_cloud_datacenter, battery_rare_earth, copper_metals, nuclear_uranium, power_producers, space_comms, crypto, cybersecurity, memory_storage, ai_semis, analog_power_chips, chip_equipment_design, optical_connectivity, power_equipment, ai_servers_network | W2, W3, W6 | financials_payments | -2.4% | -4.3% | -2.4% | -4.3% | no |

## Which warning indicators helped

On-share of trading days in the window: W1 62%, W2 7%, W3 9%, W4 28%, W5 37%, W7 7%, W6(any theme) 74%.

**Alerts with vs without each warning on at the start (recommended setting):**

| warning | on-share of days | alerts with it on | useful (on) | alerts with it off | useful (off) |
|---|---|---|---|---|---|
| W1 | 62% | 27 | 22% | 10 | 50% |
| W2 | 7% | 5 | 60% | 32 | 25% |
| W3 | 9% | 18 | 28% | 19 | 32% |
| W4 | 28% | 11 | 36% | 26 | 27% |
| W5 | 37% | 13 | 54% | 24 | 17% |
| W6 | 74% | 24 | 21% | 13 | 46% |
| W7 | 7% | 14 | 29% | 23 | 30% |

**Leave-one-out.** Each row removes one warning from the count and keeps everything else, at K = 3 and at K = 4:

| K | dropped | alerts/yr | banner days | useful | caught | >=25% | ^SOX | fires 10/08 |
|---|---|---|---|---|---|---|---|---|
| 3 | - | 3.43 | 37% | 30% | 100 (29%) | 33/134 | 5/14 | yes |
| 3 | W1 | 1.58 | 21% | 53% | 71 (21%) | 28/134 | 5/14 | yes |
| 3 | W2 | 3.34 | 35% | 28% | 91 (26%) | 31/134 | 5/14 | yes |
| 3 | W3 | 2.32 | 29% | 32% | 84 (24%) | 29/134 | 4/14 | yes |
| 3 | W4 | 2.88 | 30% | 32% | 79 (23%) | 27/134 | 5/14 | yes |
| 3 | W5 | 2.88 | 24% | 23% | 64 (19%) | 25/134 | 3/14 | yes |
| 3 | W6 | 1.58 | 30% | 47% | 98 (28%) | 33/134 | 4/14 | yes |
| 3 | W7 | 2.69 | 30% | 34% | 87 (25%) | 31/134 | 4/14 | yes |
| 4 | - | 0.93 | 14% | 50% | 56 (16%) | 24/134 | 3/14 | yes |
| 4 | W1 | 0.74 | 4% | 25% | 5 (1%) | 0/134 | 1/14 | yes |
| 4 | W2 | 1.3 | 12% | 15% | 15 (4%) | 5/134 | 2/14 | yes |
| 4 | W3 | 0.83 | 13% | 50% | 51 (15%) | 24/134 | 3/14 | yes |
| 4 | W4 | 0.74 | 4% | 14% | 4 (1%) | 0/134 | 1/14 | yes |
| 4 | W5 | 0.65 | 5% | 29% | 7 (2%) | 1/134 | 1/14 | yes |
| 4 | W6 | 0.46 | 10% | 60% | 54 (16%) | 24/134 | 3/14 | yes |
| 4 | W7 | 0.74 | 13% | 38% | 54 (16%) | 23/134 | 3/14 | yes |

Reading:
- **W5 (core inflation) is the most valuable warning.** Dropping it cuts recall most (29% to 19%), and
  alerts with W5 on were useful 54% of the time against 17% without it.
- **W1 carries recall but not precision.** Dropping it cuts recall to 21%. But it is on 62% of days (the
  proxy-era level arm), and alerts with W1 on were useful only 22% of the time against 50% with it off.
  The velocity arm is the informative part; the level arm mostly adds a count in 2016-2023.
- **W4 (hikes) and W3 (oil)** each add 4-6 points of recall.
- **W2 (rates)** is rarely on (7%), but its 5 alerts were 60% useful.
- **W7 (breadth)** adds about 4 points of recall.
- **W6 (leaders first) adds almost nothing.** Recall goes from 28.4% to 29.0% with it, and alerts with W6 on
  were *less* useful (21% vs 46%). It is on for some theme on 74% of days. It was kept at the brief's 40% because
  removing it changes recall by 2 episodes. It is a candidate to show as a quiet indicator, not count.
- At K = 4, dropping W1, W2, W4 or W5 almost removes the signal. The 10/08 case still fires under every
  single drop, because it has 4-5 warnings on.

## Threshold sensitivity (±1 step at X4/Y1/K3, rule B)

| param | value | alerts/yr | banner days | useful | caught | >=25% | ^SOX | fires 10/08 | on 10/01-02 |
|---|---|---|---|---|---|---|---|---|---|
| w1_vel | 0.25 | 3.34 | 38% | 28% | 104 (30%) | 33/134 | 5/14 | yes | no |
| w1_vel | 0.35 | 3.43 | 37% | 32% | 99 (29%) | 33/134 | 5/14 | yes | no |
| w1_lvl | 3.25 | 3.62 | 45% | 33% | 116 (34%) | 37/134 | 8/14 | yes | no |
| w1_lvl | 3.75 | 3.25 | 33% | 31% | 91 (26%) | 32/134 | 5/14 | yes | no |
| w2_lvl | 4.75 | 3.43 | 37% | 30% | 100 (29%) | 33/134 | 5/14 | yes | no |
| w2_lvl | 5.25 | 3.43 | 37% | 30% | 100 (29%) | 33/134 | 5/14 | yes | no |
| w2_vel | 0.3 | 3.62 | 42% | 26% | 108 (31%) | 37/134 | 6/14 | yes | no |
| w2_vel | 0.5 | 3.34 | 36% | 28% | 95 (28%) | 32/134 | 5/14 | yes | no |
| w3 | 0.1 | 3.99 | 41% | 33% | 105 (30%) | 35/134 | 7/14 | yes | no |
| w3 | 0.2 | 3.06 | 34% | 36% | 91 (26%) | 30/134 | 5/14 | yes | no |
| w4_days | 30 | 3.06 | 36% | 36% | 97 (28%) | 33/134 | 5/14 | yes | no |
| w4_days | 90 | 3.9 | 43% | 36% | 108 (31%) | 35/134 | 6/14 | yes | no |
| w5 | 0.0025 | 4.45 | 44% | 33% | 105 (30%) | 35/134 | 5/14 | yes | no |
| w5 | 0.0035 | 2.97 | 33% | 31% | 94 (27%) | 31/134 | 4/14 | yes | no |
| w6_share | 0.2 | 4.45 | 48% | 29% | 111 (32%) | 35/134 | 6/14 | yes | no |
| w6_share | 0.6 | 2.23 | 32% | 42% | 98 (28%) | 33/134 | 4/14 | yes | no |
| w7 | 0.03 | 4.08 | 50% | 41% | 117 (34%) | 41/134 | 7/14 | yes | no |
| w7 | 0.07 | 2.78 | 31% | 33% | 88 (26%) | 31/134 | 4/14 | yes | no |

Base: 3.43/yr, banner days 37%, caught 100 (29%).

Chosen: the brief's thresholds, unchanged. The steps that raise recall (W1 level 3.25, W7 3%, W6 20%, W2
velocity 0.30, W4 90 days) all buy it by keeping the banner up longer. They trade recall for banner days
at a rate no better than moving K (K 3 to 2: +32 points of recall for +43 points of banner days), so none
is a free improvement. Combining several would fit 10 years of
correlated episodes. W2 level 4.75/5.25 changes nothing. Every step still fires on 10/08, and none fires
semis on 10/01-02. One near-miss to note: the core CPI known on 10/08 was 0.29%, so W5 at 0.25% would have
added a 5th warning that day.

## Big episodes the recommended setting missed

245 of 345 missed. By theme (episodes / caught / missed):

| theme | episodes | caught | missed |
|---|---|---|---|
| battery_rare_earth | 27 | 7 | 20 |
| space_comms | 26 | 6 | 20 |
| crypto | 25 | 10 | 15 |
| optical_connectivity | 24 | 9 | 15 |
| gold_silver | 21 | 7 | 14 |
| memory_storage | 21 | 7 | 14 |
| nuclear_uranium | 21 | 5 | 16 |
| copper_metals | 18 | 6 | 12 |
| cybersecurity | 17 | 4 | 13 |
| chip_equipment_design | 16 | 5 | 11 |
| analog_power_chips | 14 | 3 | 11 |
| software_internet | 14 | 3 | 11 |
| ai_semis | 13 | 4 | 9 |
| ai_cloud_datacenter | 12 | 2 | 10 |
| big_tech | 12 | 5 | 7 |
| power_equipment | 12 | 2 | 10 |
| ai_servers_network | 11 | 3 | 8 |
| power_producers | 11 | 3 | 8 |
| oil_gas | 10 | 3 | 7 |
| defense_aerospace | 9 | 2 | 7 |
| financials_payments | 7 | 2 | 5 |
| regulated_utilities | 4 | 2 | 2 |

Misses are spread across every theme. Volatile themes (battery_rare_earth, space_comms, crypto,
nuclear_uranium) simply have more episodes. Nearly every miss is a warning-count miss, not a price-test
miss: the theme did fall >= 4% from its 20-day high with a down day before the half-way point, but
fewer than 3 macro warnings were on. That is why K decides recall. ^SOX
episodes are listed below. 5/14 were caught at K = 3, and 9/14 at K = 2 (same X/Y). The misses at
K = 3 include the Feb-Mar 2020 COVID drop, the 2025 tariff drop and Jul 2024. Of the 245 misses,
244 passed the price test between peak and half but had fewer than 3 warnings on.
110 of those had exactly 2 warnings on.

| ^SOX peak | half | trough | depth | caught K=3 | caught K=2 |
|---|---|---|---|---|---|
| 2018-09-04 | 2018-10-10 | 2018-10-29 | -19.2% | no | yes |
| 2018-12-03 | 2018-12-07 | 2018-12-24 | -16.0% | no | no |
| 2019-04-24 | 2019-05-13 | 2019-05-31 | -18.4% | no | no |
| 2020-02-19 | 2020-03-09 | 2020-03-18 | -35.0% | no | no |
| 2021-12-27 | 2022-01-20 | 2022-03-14 | -24.6% | yes | yes |
| 2022-03-29 | 2022-04-11 | 2022-06-16 | -29.2% | yes | yes |
| 2022-08-04 | 2022-09-02 | 2022-10-14 | -29.8% | yes | yes |
| 2023-08-01 | 2023-08-11 | 2023-10-25 | -16.9% | no | yes |
| 2024-03-07 | 2024-03-19 | 2024-04-19 | -16.6% | no | yes |
| 2024-07-10 | 2024-07-24 | 2024-08-07 | -25.0% | no | no |
| 2025-01-22 | 2025-03-06 | 2025-04-08 | -34.9% | no | yes |
| 2026-02-25 | 2026-03-03 | 2026-03-30 | -15.6% | yes | yes |
| 2026-06-22 | 2026-07-07 | 2026-07-29 | -28.6% | no | no |
| 2026-10-06 | 2026-10-14 | 2026-10-16 | -15.7% | yes | yes |

All missed episodes, deepest first:

| theme | peak | half-drawdown day | trough | depth |
|---|---|---|---|---|
| crypto | 2021-11-09 | 2021-12-06 | 2022-01-27 | -59.1% |
| oil_gas | 2020-01-06 | 2020-03-09 | 2020-03-18 | -57.5% |
| defense_aerospace | 2020-02-12 | 2020-03-09 | 2020-03-23 | -53.7% |
| space_comms | 2026-05-27 | 2026-06-09 | 2026-07-31 | -52.6% |
| optical_connectivity | 2025-01-22 | 2025-01-27 | 2025-04-04 | -51.7% |
| power_producers | 2020-02-18 | 2020-03-09 | 2020-03-18 | -49.5% |
| battery_rare_earth | 2020-02-20 | 2020-03-09 | 2020-03-23 | -47.5% |
| power_equipment | 2020-02-19 | 2020-03-09 | 2020-03-23 | -45.8% |
| space_comms | 2020-01-16 | 2020-03-09 | 2020-03-23 | -45.0% |
| power_producers | 2025-01-24 | 2025-02-27 | 2025-04-04 | -44.9% |
| copper_metals | 2020-01-17 | 2020-02-27 | 2020-03-23 | -44.1% |
| financials_payments | 2020-02-19 | 2020-03-09 | 2020-03-23 | -43.4% |
| memory_storage | 2020-01-23 | 2020-03-09 | 2020-03-18 | -42.4% |
| crypto | 2025-10-06 | 2025-11-06 | 2025-12-31 | -41.0% |
| nuclear_uranium | 2020-02-13 | 2020-03-09 | 2020-03-18 | -40.9% |
| optical_connectivity | 2026-06-02 | 2026-07-07 | 2026-07-29 | -40.9% |
| crypto | 2025-01-17 | 2025-02-24 | 2025-04-08 | -40.6% |
| memory_storage | 2025-01-22 | 2025-03-10 | 2025-04-04 | -40.5% |
| crypto | 2026-01-14 | 2026-02-02 | 2026-02-05 | -40.2% |
| battery_rare_earth | 2026-05-11 | 2026-06-05 | 2026-07-29 | -39.6% |
| memory_storage | 2026-06-22 | 2026-07-02 | 2026-07-29 | -39.0% |
| power_equipment | 2025-01-23 | 2025-01-27 | 2025-04-04 | -38.7% |
| ai_cloud_datacenter | 2025-09-22 | 2025-11-06 | 2025-12-15 | -38.0% |
| cybersecurity | 2020-02-19 | 2020-03-09 | 2020-03-16 | -37.8% |
| crypto | 2024-07-22 | 2024-08-02 | 2024-09-06 | -37.5% |
| space_comms | 2025-10-15 | 2025-11-06 | 2025-11-20 | -37.3% |
| cybersecurity | 2021-11-09 | 2021-12-01 | 2022-01-27 | -37.0% |
| nuclear_uranium | 2026-05-06 | 2026-05-19 | 2026-07-29 | -37.0% |
| analog_power_chips | 2020-01-23 | 2020-03-09 | 2020-03-18 | -36.9% |
| chip_equipment_design | 2020-02-13 | 2020-03-09 | 2020-03-18 | -36.9% |
| space_comms | 2025-02-10 | 2025-02-25 | 2025-04-04 | -36.8% |
| battery_rare_earth | 2024-05-14 | 2024-06-14 | 2024-08-07 | -36.6% |
| crypto | 2021-04-16 | 2021-05-06 | 2021-05-21 | -36.6% |
| nuclear_uranium | 2021-11-09 | 2021-11-30 | 2022-01-27 | -36.3% |
| ai_semis | 2025-01-22 | 2025-02-27 | 2025-04-04 | -36.0% |
| regulated_utilities | 2020-02-18 | 2020-03-12 | 2020-03-23 | -35.6% |
| nuclear_uranium | 2025-10-15 | 2025-10-22 | 2025-12-17 | -35.5% |
| space_comms | 2023-12-27 | 2024-01-24 | 2024-03-19 | -35.2% |
| memory_storage | 2024-06-18 | 2024-07-18 | 2024-09-06 | -34.9% |
| optical_connectivity | 2020-02-12 | 2020-02-27 | 2020-03-16 | -34.9% |
| software_internet | 2022-02-09 | 2022-02-23 | 2022-05-06 | -34.5% |
| ai_servers_network | 2020-02-12 | 2020-02-27 | 2020-03-16 | -34.3% |
| software_internet | 2021-11-16 | 2021-12-20 | 2022-01-27 | -34.2% |
| software_internet | 2020-02-19 | 2020-03-09 | 2020-03-16 | -34.0% |
| chip_equipment_design | 2026-06-30 | 2026-07-07 | 2026-07-29 | -33.6% |
| cybersecurity | 2019-08-13 | 2019-09-09 | 2019-10-22 | -33.3% |
| battery_rare_earth | 2023-12-26 | 2024-01-11 | 2024-02-05 | -32.9% |
| analog_power_chips | 2025-02-20 | 2025-03-28 | 2025-04-08 | -32.7% |
| crypto | 2023-12-27 | 2024-01-11 | 2024-01-24 | -32.7% |
| crypto | 2024-03-25 | 2024-04-05 | 2024-04-30 | -32.4% |
| space_comms | 2026-01-16 | 2026-02-04 | 2026-03-30 | -32.3% |
| ai_semis | 2020-02-19 | 2020-03-09 | 2020-03-16 | -31.8% |
| memory_storage | 2018-08-28 | 2018-10-09 | 2018-10-29 | -31.4% |
| software_internet | 2025-02-18 | 2025-03-06 | 2025-04-04 | -31.4% |
| battery_rare_earth | 2025-03-19 | 2025-04-04 | 2025-06-02 | -31.1% |
| power_equipment | 2018-09-25 | 2018-10-23 | 2018-12-20 | -30.6% |
| crypto | 2023-02-02 | 2023-02-09 | 2023-03-10 | -30.4% |
| power_equipment | 2021-11-19 | 2021-12-17 | 2022-01-27 | -30.3% |
| battery_rare_earth | 2018-01-08 | 2018-01-24 | 2018-03-28 | -30.2% |
| nuclear_uranium | 2024-07-12 | 2024-07-25 | 2024-09-06 | -30.2% |
| nuclear_uranium | 2026-01-28 | 2026-02-04 | 2026-03-30 | -30.2% |
| ai_servers_network | 2025-02-18 | 2025-03-10 | 2025-04-04 | -30.0% |
| crypto | 2024-11-20 | 2024-11-26 | 2024-12-31 | -29.7% |
| battery_rare_earth | 2026-08-21 | 2026-09-11 | 2026-10-16 | -29.3% |
| chip_equipment_design | 2024-07-10 | 2024-07-19 | 2024-09-06 | -29.1% |
| gold_silver | 2020-02-24 | 2020-03-11 | 2020-03-13 | -29.0% |
| cybersecurity | 2024-07-05 | 2024-07-22 | 2024-08-05 | -28.7% |
| space_comms | 2021-09-09 | 2021-09-14 | 2021-12-03 | -28.7% |
| gold_silver | 2026-02-27 | 2026-03-13 | 2026-03-20 | -28.5% |
| memory_storage | 2018-11-07 | 2018-12-07 | 2018-12-24 | -28.5% |
| battery_rare_earth | 2018-11-06 | 2018-12-10 | 2018-12-24 | -28.4% |
| power_equipment | 2021-01-26 | 2021-02-18 | 2021-04-20 | -28.4% |
| chip_equipment_design | 2025-01-22 | 2025-03-03 | 2025-04-04 | -27.9% |
| space_comms | 2023-09-01 | 2023-09-20 | 2023-10-27 | -27.8% |
| space_comms | 2016-05-16 | 2016-06-03 | 2016-06-27 | -27.6% |
| battery_rare_earth | 2025-10-14 | 2025-10-21 | 2025-11-06 | -27.5% |
| big_tech | 2020-02-19 | 2020-02-27 | 2020-03-16 | -27.5% |
| optical_connectivity | 2018-08-31 | 2018-10-05 | 2018-11-12 | -27.5% |
| defense_aerospace | 2018-10-03 | 2018-10-29 | 2018-12-24 | -27.4% |
| nuclear_uranium | 2018-10-04 | 2018-11-12 | 2018-12-24 | -27.3% |
| gold_silver | 2016-08-02 | 2016-08-24 | 2016-10-11 | -27.2% |
| nuclear_uranium | 2026-08-25 | 2026-09-15 | 2026-10-14 | -27.2% |
| optical_connectivity | 2024-07-16 | 2024-07-25 | 2024-08-07 | -27.2% |
| ai_cloud_datacenter | 2021-12-15 | 2022-01-18 | 2022-02-23 | -27.0% |
| gold_silver | 2026-04-17 | 2026-04-29 | 2026-07-13 | -27.0% |
| cybersecurity | 2025-02-18 | 2025-03-05 | 2025-04-04 | -26.8% |
| ai_cloud_datacenter | 2026-06-16 | 2026-07-02 | 2026-07-29 | -26.7% |
| battery_rare_earth | 2019-02-25 | 2019-03-27 | 2019-05-17 | -26.6% |
| analog_power_chips | 2026-06-22 | 2026-06-26 | 2026-09-01 | -26.4% |
| power_equipment | 2026-06-22 | 2026-07-16 | 2026-07-29 | -26.4% |
| oil_gas | 2018-10-09 | 2018-10-24 | 2018-12-24 | -26.2% |
| ai_semis | 2024-07-10 | 2024-07-24 | 2024-08-07 | -25.9% |
| power_producers | 2024-05-28 | 2024-06-07 | 2024-08-05 | -25.7% |
| ai_cloud_datacenter | 2026-01-12 | 2026-01-30 | 2026-02-05 | -25.6% |
| nuclear_uranium | 2024-11-22 | 2024-12-12 | 2025-02-24 | -25.5% |
| oil_gas | 2020-08-12 | 2020-09-10 | 2020-10-28 | -25.4% |
| optical_connectivity | 2026-08-17 | 2026-08-19 | 2026-09-14 | -25.4% |
| space_comms | 2021-12-08 | 2022-01-05 | 2022-01-27 | -25.2% |
| gold_silver | 2018-07-05 | 2018-08-13 | 2018-09-11 | -25.0% |
| memory_storage | 2019-04-18 | 2019-05-13 | 2019-05-31 | -25.0% |
| space_comms | 2018-01-22 | 2018-02-05 | 2018-04-06 | -25.0% |
| memory_storage | 2016-03-22 | 2016-04-14 | 2016-05-13 | -24.9% |
| chip_equipment_design | 2018-08-08 | 2018-09-12 | 2018-10-24 | -24.8% |
| memory_storage | 2026-03-17 | 2026-03-26 | 2026-03-30 | -24.8% |
| ai_semis | 2018-10-03 | 2018-10-19 | 2018-12-24 | -24.7% |
| software_internet | 2025-11-03 | 2025-11-19 | 2026-01-30 | -24.6% |
| battery_rare_earth | 2023-10-17 | 2023-10-19 | 2023-11-09 | -24.3% |
| crypto | 2025-07-17 | 2025-08-01 | 2025-09-03 | -24.1% |
| battery_rare_earth | 2019-06-11 | 2019-08-05 | 2019-08-27 | -23.5% |
| battery_rare_earth | 2021-11-12 | 2021-12-14 | 2022-01-27 | -23.4% |
| nuclear_uranium | 2025-02-26 | 2025-03-10 | 2025-04-04 | -23.3% |
| oil_gas | 2020-06-08 | 2020-06-11 | 2020-07-09 | -23.2% |
| gold_silver | 2016-11-03 | 2016-11-11 | 2016-12-15 | -23.1% |
| battery_rare_earth | 2026-01-23 | 2026-01-30 | 2026-03-20 | -23.0% |
| copper_metals | 2025-03-25 | 2025-04-03 | 2025-04-08 | -22.9% |
| software_internet | 2018-10-01 | 2018-10-10 | 2018-12-24 | -22.8% |
| power_producers | 2026-02-25 | 2026-03-20 | 2026-05-19 | -22.1% |
| copper_metals | 2026-03-02 | 2026-03-06 | 2026-03-20 | -22.0% |
| optical_connectivity | 2023-08-31 | 2023-09-21 | 2023-10-26 | -22.0% |
| copper_metals | 2019-07-02 | 2019-08-01 | 2019-08-23 | -21.8% |
| software_internet | 2026-06-01 | 2026-06-05 | 2026-06-25 | -21.8% |
| battery_rare_earth | 2024-12-03 | 2024-12-18 | 2025-03-03 | -21.6% |
| ai_cloud_datacenter | 2020-02-20 | 2020-02-28 | 2020-03-23 | -21.4% |
| power_producers | 2026-01-15 | 2026-01-20 | 2026-02-05 | -21.4% |
| defense_aerospace | 2020-06-08 | 2020-06-11 | 2020-07-09 | -21.3% |
| ai_servers_network | 2020-08-04 | 2020-08-17 | 2020-10-28 | -21.2% |
| cybersecurity | 2018-09-14 | 2018-10-10 | 2018-11-20 | -21.2% |
| financials_payments | 2025-02-18 | 2025-03-10 | 2025-04-04 | -21.2% |
| memory_storage | 2020-06-08 | 2020-06-24 | 2020-08-21 | -21.2% |
| crypto | 2026-03-17 | 2026-03-24 | 2026-03-30 | -21.1% |
| gold_silver | 2026-08-25 | 2026-09-14 | 2026-10-14 | -21.1% |
| space_comms | 2018-11-28 | 2018-12-14 | 2018-12-24 | -21.1% |
| optical_connectivity | 2019-02-25 | 2019-05-13 | 2019-05-20 | -21.0% |
| ai_semis | 2019-04-24 | 2019-05-13 | 2019-06-03 | -20.9% |
| copper_metals | 2024-09-27 | 2024-11-11 | 2024-12-19 | -20.8% |
| memory_storage | 2018-03-16 | 2018-03-27 | 2018-05-02 | -20.7% |
| nuclear_uranium | 2016-07-14 | 2016-09-12 | 2016-10-06 | -20.6% |
| power_producers | 2025-10-15 | 2025-10-22 | 2026-01-08 | -20.6% |
| ai_cloud_datacenter | 2024-12-06 | 2024-12-18 | 2025-03-06 | -20.4% |
| gold_silver | 2020-11-06 | 2020-11-17 | 2020-11-24 | -20.4% |
| space_comms | 2024-08-19 | 2024-08-27 | 2024-09-10 | -20.4% |
| optical_connectivity | 2017-11-21 | 2017-12-04 | 2018-02-05 | -20.3% |
| analog_power_chips | 2023-07-31 | 2023-08-16 | 2023-10-23 | -20.2% |
| software_internet | 2026-02-02 | 2026-02-05 | 2026-04-10 | -20.0% |
| big_tech | 2018-08-31 | 2018-10-11 | 2018-11-23 | -19.9% |
| copper_metals | 2024-05-20 | 2024-06-11 | 2024-08-07 | -19.8% |
| cybersecurity | 2025-11-03 | 2025-11-20 | 2026-01-30 | -19.8% |
| memory_storage | 2025-11-10 | 2025-11-18 | 2025-11-20 | -19.8% |
| analog_power_chips | 2018-07-18 | 2018-09-11 | 2018-10-10 | -19.7% |
| gold_silver | 2023-12-27 | 2024-01-16 | 2024-02-28 | -19.7% |
| ai_servers_network | 2019-07-15 | 2019-08-05 | 2019-08-15 | -19.6% |
| big_tech | 2024-12-17 | 2025-02-25 | 2025-03-18 | -19.6% |
| gold_silver | 2021-01-07 | 2021-01-27 | 2021-03-01 | -19.6% |
| space_comms | 2025-12-11 | 2025-12-15 | 2025-12-17 | -19.5% |
| chip_equipment_design | 2018-12-03 | 2018-12-07 | 2018-12-24 | -19.3% |
| ai_servers_network | 2018-10-03 | 2018-10-11 | 2018-12-24 | -19.2% |
| copper_metals | 2026-06-02 | 2026-06-05 | 2026-07-08 | -19.2% |
| crypto | 2021-06-29 | 2021-07-14 | 2021-07-19 | -19.2% |
| ai_cloud_datacenter | 2026-09-08 | 2026-09-14 | 2026-10-16 | -19.1% |
| optical_connectivity | 2018-12-03 | 2018-12-17 | 2018-12-24 | -19.1% |
| power_equipment | 2024-05-24 | 2024-06-28 | 2024-08-05 | -18.9% |
| financials_payments | 2022-02-09 | 2022-03-01 | 2022-03-07 | -18.8% |
| ai_servers_network | 2024-07-08 | 2024-07-25 | 2024-08-07 | -18.7% |
| big_tech | 2018-12-03 | 2018-12-17 | 2018-12-24 | -18.7% |
| chip_equipment_design | 2024-10-14 | 2024-10-15 | 2024-11-15 | -18.7% |
| defense_aerospace | 2026-08-05 | 2026-09-01 | 2026-10-07 | -18.7% |
| ai_semis | 2024-03-07 | 2024-04-17 | 2024-04-19 | -18.6% |
| memory_storage | 2018-05-30 | 2018-06-25 | 2018-08-16 | -18.6% |
| chip_equipment_design | 2026-08-17 | 2026-08-28 | 2026-09-15 | -18.5% |
| ai_semis | 2026-06-02 | 2026-06-05 | 2026-07-29 | -18.4% |
| analog_power_chips | 2025-08-26 | 2025-10-10 | 2025-11-17 | -18.4% |
| regulated_utilities | 2023-07-21 | 2023-09-05 | 2023-10-02 | -18.4% |
| copper_metals | 2021-05-11 | 2021-05-19 | 2021-06-18 | -18.2% |
| optical_connectivity | 2026-03-02 | 2026-03-05 | 2026-03-06 | -18.2% |
| ai_cloud_datacenter | 2025-03-24 | 2025-03-31 | 2025-04-21 | -18.0% |
| cybersecurity | 2026-02-02 | 2026-02-05 | 2026-02-23 | -18.0% |
| power_equipment | 2023-09-01 | 2023-09-21 | 2023-10-20 | -17.9% |
| battery_rare_earth | 2021-03-15 | 2021-03-23 | 2021-05-25 | -17.7% |
| copper_metals | 2016-04-29 | 2016-05-04 | 2016-06-14 | -17.7% |
| power_producers | 2024-10-04 | 2024-10-10 | 2024-11-04 | -17.7% |
| ai_cloud_datacenter | 2023-09-11 | 2023-09-12 | 2023-10-25 | -17.6% |
| analog_power_chips | 2024-07-16 | 2024-07-25 | 2024-08-07 | -17.6% |
| defense_aerospace | 2020-03-26 | 2020-03-31 | 2020-04-03 | -17.6% |
| space_comms | 2025-07-18 | 2025-07-28 | 2025-08-20 | -17.6% |
| ai_semis | 2024-08-19 | 2024-09-03 | 2024-09-06 | -17.5% |
| big_tech | 2025-03-25 | 2025-04-03 | 2025-04-08 | -17.4% |
| copper_metals | 2018-06-06 | 2018-06-19 | 2018-08-15 | -17.4% |
| cybersecurity | 2024-02-14 | 2024-02-21 | 2024-04-19 | -17.4% |
| oil_gas | 2025-04-01 | 2025-04-04 | 2025-04-08 | -17.4% |
| space_comms | 2019-05-10 | 2019-06-24 | 2019-08-06 | -17.4% |
| gold_silver | 2025-10-16 | 2025-10-21 | 2025-11-04 | -17.3% |
| gold_silver | 2020-08-05 | 2020-08-11 | 2020-10-28 | -17.1% |
| optical_connectivity | 2025-11-10 | 2025-11-13 | 2025-11-20 | -17.1% |
| financials_payments | 2018-09-20 | 2018-10-11 | 2018-12-17 | -17.0% |
| optical_connectivity | 2026-03-25 | 2026-03-26 | 2026-03-30 | -17.0% |
| battery_rare_earth | 2022-02-16 | 2022-02-17 | 2022-02-23 | -16.9% |
| chip_equipment_design | 2026-02-25 | 2026-03-03 | 2026-03-30 | -16.9% |
| ai_servers_network | 2026-10-09 | 2026-10-14 | 2026-10-16 | -16.8% |
| space_comms | 2016-08-31 | 2016-10-13 | 2016-11-03 | -16.8% |
| analog_power_chips | 2026-02-11 | 2026-03-05 | 2026-03-30 | -16.7% |
| financials_payments | 2026-01-06 | 2026-02-12 | 2026-03-27 | -16.7% |
| ai_cloud_datacenter | 2018-09-28 | 2018-10-11 | 2018-12-24 | -16.6% |
| chip_equipment_design | 2018-01-23 | 2018-02-02 | 2018-02-08 | -16.6% |
| space_comms | 2020-08-07 | 2020-09-10 | 2020-09-24 | -16.6% |
| oil_gas | 2021-06-15 | 2021-07-15 | 2021-08-19 | -16.5% |
| power_producers | 2026-05-26 | 2026-06-01 | 2026-06-10 | -16.5% |
| crypto | 2026-07-06 | 2026-07-16 | 2026-07-29 | -16.4% |
| analog_power_chips | 2019-05-03 | 2019-05-13 | 2019-05-28 | -16.3% |
| nuclear_uranium | 2021-09-15 | 2021-09-20 | 2021-09-24 | -16.3% |
| cybersecurity | 2025-07-09 | 2025-07-30 | 2025-08-08 | -16.2% |
| optical_connectivity | 2024-03-04 | 2024-03-14 | 2024-04-19 | -16.2% |
| battery_rare_earth | 2018-05-16 | 2018-05-24 | 2018-07-23 | -16.1% |
| battery_rare_earth | 2021-01-19 | 2021-01-27 | 2021-03-08 | -16.0% |
| big_tech | 2020-09-02 | 2020-09-08 | 2020-09-23 | -16.0% |
| copper_metals | 2018-09-25 | 2018-10-19 | 2018-12-10 | -16.0% |
| cybersecurity | 2026-10-09 | 2026-10-14 | 2026-10-16 | -16.0% |
| power_equipment | 2026-08-17 | 2026-08-19 | 2026-10-16 | -16.0% |
| ai_semis | 2025-10-29 | 2025-11-06 | 2025-12-17 | -15.9% |
| software_internet | 2019-07-26 | 2019-08-05 | 2019-10-02 | -15.9% |
| copper_metals | 2017-01-25 | 2017-02-23 | 2017-04-19 | -15.8% |
| crypto | 2026-05-29 | 2026-06-03 | 2026-06-05 | -15.8% |
| defense_aerospace | 2026-03-02 | 2026-03-19 | 2026-05-15 | -15.8% |
| battery_rare_earth | 2024-03-01 | 2024-03-05 | 2024-04-22 | -15.7% |
| gold_silver | 2017-02-08 | 2017-02-27 | 2017-03-09 | -15.7% |
| memory_storage | 2017-11-24 | 2017-11-29 | 2017-12-04 | -15.7% |
| nuclear_uranium | 2017-02-14 | 2017-02-24 | 2017-05-04 | -15.7% |
| nuclear_uranium | 2019-07-10 | 2019-07-25 | 2019-08-05 | -15.7% |
| space_comms | 2018-08-09 | 2018-08-10 | 2018-10-29 | -15.7% |
| cybersecurity | 2020-10-13 | 2020-10-21 | 2020-11-02 | -15.6% |
| chip_equipment_design | 2021-09-16 | 2021-09-28 | 2021-10-04 | -15.5% |
| nuclear_uranium | 2024-02-01 | 2024-02-08 | 2024-02-23 | -15.4% |
| optical_connectivity | 2025-12-11 | 2025-12-12 | 2025-12-17 | -15.4% |
| ai_servers_network | 2026-06-02 | 2026-06-05 | 2026-07-29 | -15.3% |
| oil_gas | 2018-01-22 | 2018-02-05 | 2018-03-28 | -15.3% |
| software_internet | 2024-02-09 | 2024-03-15 | 2024-04-19 | -15.3% |
| analog_power_chips | 2024-10-29 | 2024-11-13 | 2025-01-28 | -15.2% |
| nuclear_uranium | 2020-08-28 | 2020-09-23 | 2020-11-04 | -15.2% |
| power_equipment | 2019-07-01 | 2019-08-02 | 2019-08-14 | -15.2% |
| software_internet | 2021-04-13 | 2021-05-04 | 2021-05-13 | -15.2% |
| space_comms | 2020-06-08 | 2020-06-11 | 2020-06-26 | -15.2% |
| cybersecurity | 2016-04-01 | 2016-05-04 | 2016-06-27 | -15.1% |
| defense_aerospace | 2020-04-17 | 2020-04-21 | 2020-05-15 | -15.1% |
| analog_power_chips | 2018-12-03 | 2018-12-07 | 2018-12-24 | -15.0% |
| big_tech | 2024-07-10 | 2024-07-24 | 2024-08-05 | -15.0% |
| gold_silver | 2020-05-19 | 2020-05-26 | 2020-06-05 | -15.0% |

## Limits

- **Survivorship.** The themes are today's watchlist (top caps chosen in 2026, R-D17). Past theme indices
  are built from companies that survived and grew, so drawdowns look shallower and recoveries faster than
  a point-in-time universe would show. IPOs enter late: 2021+ names only from their listing.
- **shares_now weighting** approximates past caps (R-D18). Weights are wrong wherever share counts moved
  a lot (buybacks at AAPL, dilution at crypto miners, 10x growth names).
- **FRED revisions and vintages are ignored.** Current-vintage CPI/PCE are used with release-date lags, not
  first prints. Daily series are lagged 1 business day; the Brent lag is understated.
- **The HY proxy before 2023-10-17** is a regression and frequency-match on 3 calm years; its level arm is near
  always-on in 2016-2022.
- **One-sample acceptance.** The 2026-10-08 case is a single event. X <= 4 is preferred partly because X = 5-6
  pass only through the three deepest semis themes.
- **Episodes overlap across themes** (one market selloff gives many theme episodes). The 345 are not
  independent, and recall percentages overstate the effective sample.
- Forward returns for alerts in the last 20 trading days are incomplete (marked).

## Reproducibility

Scripts in `bt2/` (this folder):
- `fetch_data.py`: reads the local DB read-only and writes `cache/` (watchlist, DB closes, shares). It also
  downloads yfinance closes (watchlist + ^SOX/RSP/SPY) and the 8 FRED series. It reads `FRED_API_KEY` from
  `config/.env` and never prints it.
- `fetch_hy_proxy.py`: FRED BAA10Y + yfinance HYG/IEF (proxy candidates for W1).
- `probe_hy.py`: shows FRED's 3-year limit on BAMLH0A0HYM2 and the ALFRED 400 error.
- `probe_proxy.py`: compares BAA10Y and HYG/IEF on the overlap.
- `backtest.py`: the full grid, lifecycle rules A/B, sensitivity and ablation. Writes `results.json` and `out/run.pkl` (~25 s).
- `report.py`: writes this file from `results.json`.
- `inspect_k.py`: ad-hoc look at a few settings' 2026 alerts.

Rerun: `python fetch_data.py && python fetch_hy_proxy.py && python backtest.py && python report.py`.
`fetch_data.py` skips the yfinance close download if `cache/yf_close.csv` exists; it re-fetches FRED and the
yfinance share counts every time. `backtest.py` and `report.py` alone reproduce this report from `cache/`.
`out/grid.pkl` is the interrupted earlier run's output and is not used. FRED will
then still return HY only for the last 3 years.
