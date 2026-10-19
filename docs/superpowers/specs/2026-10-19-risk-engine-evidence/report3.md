# Risk-alert backtest, round 3: reduce banner time

Research output; nothing in the repo was changed. Same data, window (2016-01-04..2026-10-16, 10.78 years), 22 trigger themes and 345 episodes as round 2. `breadth.py` imports `backtest.py` unchanged; the round-2 recommendation is reproduced exactly (X4 Y1 K3, rule B: 37 alerts, 3.43/yr, banner 37.3%, 100/345, ^SOX 5/14).

## Pick

**X = 4%, Y = 2 down days, K = 3, open gate = confirming themes hold >= 20% of watchlist cap OR ^SOX confirming, per-theme exit Q = 5 days (or back within 3% of the 20d high), W6 dropped.**

- Banner up on **15%** of trading days (round 2: 37%). 11 alerts, **1.02/yr**. Longest alert 101 trading days.
- Useful: **80% per alert**, 40% per theme join (base rate 25%). Median primary-theme fwd10 -2.01%.
- Recall **87/345** (round 2: 100; floor 80). >= 25% drops 30/134. ^SOX 4/14.
- 2026-10-08: a new alert **opens on 10/08** with all five semis themes (ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity). Nothing at all is up on 10/01-10/02 (no alert of any theme).
- Changes vs round 2: Y 1 -> 2, cap-share open gate, Q 15 -> 5, W6 out of the count. X and K are unchanged.

**Runner-up (lowest banner share overall):** `X5Y2K3 open=N3d1 stay=N Q=5 W6=off` - banner 14%, 2.13/yr, useful 70%, recall 89/345, ^SOX 4/14. Not picked: on 10/08 only chip_equipment_design, optical_connectivity are in the alert (X = 5 relies on themes falling more than ^SOX, fragile per round 2), and a non-semis alert opened 2026-09-24 is up on 10/01-10/02. If the 10/01-02 rule only concerns semis, it is the minimum (1.1 points lower).

## Method changes (round 3)

- **^SOX confirming** = ^SOX price test (dd20 <= -X%, >= Y down days) and the warning count >= K (market warnings + W6 of any semis theme; market only when W6 is dropped). It opens / holds an alert on its own; the semis themes passing through it are the members.
- **Open gates.** `any` = round 2. `N{n}d1` = >= n themes confirming that day. `N{n}d3` = >= n distinct themes confirming within the last 3 trading days (all of them join on the open day). `cap{S}` = confirming themes together hold >= S% of total watchlist cap (shares_now x close that day, 250 tickers incl. defensives). Themes that confirm while an alert is open always join it.
- **Stay gate** (`stay=N`, N-gates only): the alert closes when fewer than N themes remain and ^SOX is not confirming. **Exit Q**: a theme leaves when back within 3% of its 20d high or after Q days with no new 20d low.
- **Banner share** = trading days with an alert up (start..release inclusive) / evaluation days.
- **Recall** now requires the banner to be up: an episode is caught when the theme's own banner test fires on a day in [peak, half] *and* an alert is up that day (so the theme is in it). Under the ungated open this is identical to round 2. ^SOX recall likewise (a semis confirmation in [peak, half] while an alert is up).
- **Useful per theme** = each theme join into an alert (incl. re-joins), further >= 5% drop within 10 days.
- **Acceptance**: 10/08 must have an alert up with a semis theme confirming; no semis banner test and no semis in an alert on 10/01-10/02. The pick additionally requires *no alert at all* up on 10/01-10/02.
- Grid: X {3,4,5} x Y {1,2} x K {2,3} x 7 open gates x stay (N-gates) x Q {5,10,15} x W6 on/off = 792 settings. 780 of them fire on 10/08; 192 have semis early.

## Each variant on its own

At round 2's X4 Y1 K3 (W6 on unless stated):

| setting | banner up | alerts/yr | useful (alert) | useful (theme) | median fwd10 | recall | >=25% | ^SOX | 10/08 | up on 10/01-02 |
|---|---|---|---|---|---|---|---|---|---|---|
| X4Y1K3 open=any stay=- Q=15 W6=on | 37% | 3.43 | 30% | 37% | +2.24% | 100/345 | 33/134 | 5/14 | open since 2026-09-16: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-16) |
| X4Y1K3 open=N2d1 stay=- Q=15 W6=on | 31% | 2.13 | 48% | 37% | +2.25% | 97/345 | 33/134 | 5/14 | open since 2026-09-17: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-17) |
| X4Y1K3 open=N3d1 stay=- Q=15 W6=on | 30% | 1.86 | 55% | 38% | +2.07% | 97/345 | 33/134 | 5/14 | open since 2026-09-21: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-21) |
| X4Y1K3 open=N2d3 stay=- Q=15 W6=on | 33% | 2.41 | 46% | 37% | +2.34% | 98/345 | 33/134 | 5/14 | open since 2026-09-17: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-17) |
| X4Y1K3 open=N3d3 stay=- Q=15 W6=on | 31% | 2.04 | 50% | 38% | +2.07% | 97/345 | 33/134 | 5/14 | open since 2026-09-17: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-17) |
| X4Y1K3 open=N2d1 stay=N Q=15 W6=on | 25% | 2.6 | 50% | 37% | +2.21% | 97/345 | 33/134 | 5/14 | open since 2026-09-17: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-17) |
| X4Y1K3 open=N3d1 stay=N Q=15 W6=on | 20% | 2.78 | 60% | 38% | +0.65% | 96/345 | 33/134 | 5/14 | open since 2026-09-21: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-21) |
| X4Y1K3 open=N2d3 stay=N Q=15 W6=on | 26% | 3.25 | 49% | 37% | +2.25% | 97/345 | 33/134 | 5/14 | open since 2026-09-17: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-17) |
| X4Y1K3 open=N3d3 stay=N Q=15 W6=on | 22% | 3.52 | 58% | 38% | +1.40% | 96/345 | 33/134 | 5/14 | open since 2026-09-17: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-17) |
| X4Y1K3 open=any stay=- Q=5 W6=on | 28% | 5.01 | 33% | 38% | +2.34% | 100/345 | 33/134 | 5/14 | open since 2026-09-16: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-16) |
| X4Y1K3 open=any stay=- Q=10 W6=on | 36% | 3.8 | 32% | 38% | +2.24% | 100/345 | 33/134 | 5/14 | open since 2026-09-16: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-16) |
| X4Y1K3 open=cap10 stay=- Q=15 W6=on | 28% | 1.76 | 53% | 38% | +1.94% | 95/345 | 33/134 | 5/14 | open since 2026-09-24: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-24) |
| X4Y1K3 open=cap20 stay=- Q=15 W6=on | 26% | 1.67 | 50% | 38% | +1.98% | 95/345 | 33/134 | 5/14 | open since 2026-09-28: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-28) |
| X4Y1K3 open=any stay=- Q=15 W6=off | 30% | 1.58 | 47% | 38% | +2.13% | 98/345 | 33/134 | 4/14 | open since 2026-09-17: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-17) |

Combined, X4 Y1 K3:

| setting | banner up | alerts/yr | useful (alert) | useful (theme) | median fwd10 | recall | >=25% | ^SOX | 10/08 | up on 10/01-02 |
|---|---|---|---|---|---|---|---|---|---|---|
| X4Y1K3 open=N3d1 stay=N Q=5 W6=off | 16% | 2.13 | 65% | 40% | -0.06% | 96/345 | 33/134 | 4/14 | open since 2026-09-21: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-21) |
| X4Y1K3 open=N3d1 stay=N Q=5 W6=on | 17% | 3.25 | 57% | 40% | +0.62% | 96/345 | 33/134 | 5/14 | open since 2026-09-21: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-21) |
| X4Y1K3 open=cap20 stay=- Q=5 W6=off | 15% | 1.11 | 83% | 41% | -2.22% | 92/345 | 32/134 | 4/14 | open since 2026-09-28: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-28) |
| X4Y1K3 open=cap20 stay=- Q=5 W6=on | 18% | 2.23 | 62% | 41% | -0.05% | 92/345 | 32/134 | 5/14 | open since 2026-09-28: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-28) |
| X4Y1K3 open=cap10 stay=- Q=5 W6=off | 18% | 1.39 | 67% | 39% | -0.06% | 95/345 | 33/134 | 4/14 | open since 2026-09-24: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-24) |

At the pick's X4 Y2 K3:

| setting | banner up | alerts/yr | useful (alert) | useful (theme) | median fwd10 | recall | >=25% | ^SOX | 10/08 | up on 10/01-02 |
|---|---|---|---|---|---|---|---|---|---|---|
| X4Y2K3 open=any stay=- Q=15 W6=on | 33% | 2.5 | 41% | 38% | +2.13% | 94/345 | 31/134 | 5/14 | open since 2026-09-17: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-17) |
| X4Y2K3 open=cap20 stay=- Q=15 W6=on | 21% | 0.93 | 56% | 39% | +4.50% | 87/345 | 30/134 | 5/14 | opens 10/08: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | none |
| X4Y2K3 open=any stay=- Q=5 W6=on | 24% | 3.99 | 42% | 38% | +2.13% | 94/345 | 31/134 | 5/14 | open since 2026-09-17: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-17) |
| X4Y2K3 open=cap20 stay=- Q=5 W6=on | 16% | 1.48 | 73% | 40% | -1.37% | 87/345 | 30/134 | 5/14 | opens 10/08: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | none |
| X4Y2K3 open=cap20 stay=- Q=5 W6=off | 15% | 1.02 | 80% | 40% | -2.01% | 87/345 | 30/134 | 4/14 | opens 10/08: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | none |
| X4Y2K3 open=N3d1 stay=N Q=5 W6=off | 15% | 2.5 | 63% | 39% | +1.37% | 90/345 | 31/134 | 4/14 | open since 2026-09-21: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-21) |
| X4Y2K3 open=cap10 stay=- Q=5 W6=off | 16% | 1.21 | 69% | 39% | +1.37% | 89/345 | 30/134 | 4/14 | open since 2026-09-29: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-29) |

Reading (X4 Y1 K3, from 37%): a breadth open gate alone saves only 4-7 points, because once open the alert still lives until the last theme leaves; adding the stay gate (N3) takes it to 20%. Cap20 alone -> 26%, Q 15 -> 5 alone -> 28%, W6 off alone -> 30%. No single variant reaches 15%; it takes a gate + Q = 5 + W6 off. Each gate costs a few caught episodes, because a lone theme's confirmation no longer raises the banner. Q = 10 barely helps (36%).

## Dropping W6 (leaders-first)

Paired over all 396 settings: something changes in 396 of them. Banner share changes by -2.6 points on average (range -16.2 to -0.1), recall by -3.0 episodes (range -19 to +0), ^SOX recall by -2 to +0. Acceptance flips in 0. Alerts/yr falls by 0.77 on average and useful-per-alert rises by +4.6 points. Keeping W6 adds alerts and banner time; the recall it buys is 0-4 episodes at K = 3 (mean 0.4) and 1-19 at K = 2 (mean 5.6). At some settings it adds one ^SOX episode (at the pick: the 2026-02/03 ^SOX episode is caught only with W6 on, at +1.0 point of banner time).

## Trade-off: banner share vs recall

Lowest banner share reachable at each recall level (accepted settings, nothing up on 10/01-10/02). There is a cliff between K = 3 (<= ~100 episodes) and K = 2 (~170+ episodes, banner >= 40%).

| setting | banner up | alerts/yr | useful (alert) | useful (theme) | median fwd10 | recall | >=25% | ^SOX | 10/08 | up on 10/01-02 |
|---|---|---|---|---|---|---|---|---|---|---|
| X4Y2K3 open=cap20 stay=- Q=5 W6=off | 15% | 1.02 | 80% | 40% | -2.01% | 87/345 | 30/134 | 4/14 | opens 10/08: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | none |
| X3Y2K3 open=cap20 stay=- Q=5 W6=off | 16% | 1.39 | 57% | 37% | +3.39% | 91/345 | 31/134 | 4/14 | opens 10/08: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | none |
| X4Y2K2 open=cap20 stay=- Q=5 W6=off | 42% | 3.8 | 57% | 32% | +2.49% | 168/345 | 58/134 | 7/14 | opens 10/08: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | none |
| X4Y2K2 open=cap20 stay=- Q=5 W6=on | 45% | 4.36 | 54% | 32% | +2.29% | 172/345 | 60/134 | 8/14 | opens 10/08: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | none |
| X3Y2K2 open=cap20 stay=- Q=5 W6=off | 46% | 3.9 | 61% | 32% | +2.64% | 176/345 | 62/134 | 8/14 | opens 10/08: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | none |
| X3Y2K2 open=cap20 stay=- Q=5 W6=on | 52% | 4.64 | 57% | 32% | +2.64% | 182/345 | 64/134 | 9/14 | opens 10/08: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | none |
| X3Y2K2 open=cap20 stay=- Q=15 W6=on | 66% | 2.69 | 50% | 30% | +2.29% | 185/345 | 64/134 | 9/14 | opens 10/08: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | none |

Same, semis-only reading of the 10/01-02 rule:

| setting | banner up | alerts/yr | useful (alert) | useful (theme) | median fwd10 | recall | >=25% | ^SOX | 10/08 | up on 10/01-02 |
|---|---|---|---|---|---|---|---|---|---|---|
| X5Y2K3 open=N3d1 stay=N Q=5 W6=off | 14% | 2.13 | 70% | 42% | +0.85% | 89/345 | 31/134 | 4/14 | open since 2026-09-24: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-24) |
| X4Y2K3 open=N3d1 stay=N Q=5 W6=off | 15% | 2.5 | 63% | 39% | +1.37% | 90/345 | 31/134 | 4/14 | open since 2026-09-21: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-21) |
| X5Y1K3 open=N3d1 stay=N Q=5 W6=off | 15% | 1.86 | 85% | 44% | -0.36% | 93/345 | 33/134 | 4/14 | open since 2026-09-24: chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-24) |
| X4Y1K3 open=N3d1 stay=N Q=5 W6=off | 16% | 2.13 | 65% | 40% | -0.06% | 96/345 | 33/134 | 4/14 | open since 2026-09-21: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-21) |
| X4Y1K3 open=N3d1 stay=- Q=5 W6=off | 19% | 1.39 | 73% | 40% | +0.68% | 97/345 | 33/134 | 4/14 | open since 2026-09-21: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-21) |
| X4Y1K3 open=any stay=- Q=5 W6=off | 22% | 2.32 | 44% | 39% | +2.42% | 98/345 | 33/134 | 4/14 | open since 2026-09-17: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-17) |
| X4Y1K3 open=any stay=- Q=5 W6=on | 28% | 5.01 | 33% | 38% | +2.34% | 100/345 | 33/134 | 5/14 | open since 2026-09-16: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-16) |
| X5Y2K2 open=N3d1 stay=N Q=5 W6=off | 36% | 6.77 | 62% | 34% | +0.99% | 178/345 | 67/134 | 8/14 | open since 2026-09-16: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-16) |
| X5Y2K2 open=N3d1 stay=N Q=5 W6=on | 36% | 7.14 | 60% | 34% | +0.91% | 179/345 | 67/134 | 8/14 | open since 2026-09-16: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-16) |
| X5Y2K2 open=N3d3 stay=N Q=5 W6=off | 38% | 7.61 | 60% | 34% | +0.95% | 180/345 | 68/134 | 8/14 | open since 2026-09-16: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-16) |
| X5Y2K2 open=N3d3 stay=N Q=5 W6=on | 39% | 7.88 | 58% | 34% | +0.91% | 181/345 | 68/134 | 8/14 | open since 2026-09-16: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-16) |
| X4Y2K2 open=N3d1 stay=N Q=5 W6=off | 39% | 7.7 | 59% | 32% | +1.57% | 185/345 | 68/134 | 8/14 | open since 2026-09-16: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-16) |
| X4Y2K2 open=N3d1 stay=N Q=5 W6=on | 40% | 8.44 | 58% | 32% | +1.09% | 186/345 | 68/134 | 8/14 | open since 2026-09-16: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-16) |
| X3Y2K2 open=N3d1 stay=N Q=5 W6=off | 42% | 9.0 | 58% | 31% | +1.10% | 188/345 | 68/134 | 8/14 | open since 2026-09-16: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-16) |
| X5Y1K2 open=N3d1 stay=N Q=5 W6=off | 43% | 7.23 | 68% | 36% | +0.49% | 191/345 | 71/134 | 8/14 | open since 2026-09-16: chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-16) |
| X5Y1K2 open=N3d1 stay=N Q=5 W6=on | 43% | 7.51 | 65% | 36% | +0.62% | 192/345 | 71/134 | 9/14 | open since 2026-09-16: chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-16) |
| X5Y1K2 open=N3d3 stay=N Q=5 W6=on | 46% | 9.28 | 65% | 36% | +0.12% | 193/345 | 71/134 | 9/14 | open since 2026-09-16: chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-16) |
| X5Y1K2 open=N2d1 stay=N Q=5 W6=on | 52% | 7.23 | 50% | 36% | +2.03% | 194/345 | 71/134 | 9/14 | open since 2026-09-16: chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-16) |
| X5Y1K2 open=N2d3 stay=N Q=5 W6=on | 53% | 7.7 | 54% | 36% | +2.34% | 195/345 | 71/134 | 9/14 | open since 2026-09-16: chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-16) |
| X4Y1K2 open=cap20 stay=- Q=10 W6=on | 66% | 2.78 | 67% | 33% | +2.88% | 198/345 | 69/134 | 9/14 | open since 2026-09-28: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-28) |
| X4Y1K2 open=cap20 stay=- Q=15 W6=on | 69% | 2.32 | 72% | 32% | +2.64% | 199/345 | 69/134 | 9/14 | open since 2026-09-28: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-28) |
| X3Y2K2 open=any stay=- Q=5 W6=on | 70% | 9.65 | 33% | 30% | +1.45% | 202/345 | 70/134 | 9/14 | open since 2026-09-16: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-16) |

## Major events caught by the finalists

First day the banner is up inside the event window (^SOX peak -> trough; 2018 Q4 = 10/01-12/24, 2022 = 01/03-10/14). '(late)' = after the ^SOX half-drawdown day. '-' = never up in the window.

| setting | 2018Q4 | 2020-02 COVID | 2022 bear | 2024-07 | 2025-04 tariffs | 2026-06 |
|---|---|---|---|---|---|---|
| X4Y2K3 open=cap20 stay=- Q=5 W6=off | - | - | 2022-01-19 | - | - | - |
| X5Y2K3 open=N3d1 stay=N Q=5 W6=off | - | - | 2022-01-19 | - | - | - |
| X4Y1K3 open=cap20 stay=- Q=5 W6=off | - | - | 2022-01-19 | - | - | - |
| X4Y1K3 open=N3d1 stay=N Q=5 W6=off | - | - | 2022-01-19 | - | - | - |
| X4Y1K3 open=any stay=- Q=15 W6=on | 2018-11-09 (late) | - | 2022-01-13 | - | - | - |

COVID 2020-02, 2024-07, 2025-04 and 2026-06 are missed by every K = 3 setting, as in round 2: too few macro warnings were on. Only K = 2 reaches them, at a banner share of 40%+.

## Lowest-banner accepted settings with recall >= 80 (top 40)

| setting | banner up | alerts/yr | useful (alert) | useful (theme) | median fwd10 | recall | >=25% | ^SOX | 10/08 | up on 10/01-02 |
|---|---|---|---|---|---|---|---|---|---|---|
| X5Y2K3 open=N3d1 stay=N Q=5 W6=off | 14% | 2.13 | 70% | 42% | +0.85% | 89/345 | 31/134 | 4/14 | open since 2026-09-24: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-24) |
| X5Y2K3 open=N3d1 stay=N Q=5 W6=on | 14% | 2.32 | 68% | 42% | +0.85% | 89/345 | 31/134 | 4/14 | open since 2026-09-24: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-24) |
| X5Y1K3 open=cap20 stay=- Q=5 W6=off | 14% | 0.83 | 89% | 44% | -3.64% | 85/345 | 29/134 | 4/14 | open since 2026-09-28: chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-28) |
| X5Y1K3 open=cap10 stay=- Q=5 W6=off | 14% | 0.83 | 89% | 44% | -3.64% | 86/345 | 30/134 | 4/14 | open since 2026-09-28: chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-28) |
| X5Y2K3 open=cap10 stay=- Q=5 W6=off | 14% | 0.83 | 78% | 42% | -2.66% | 85/345 | 29/134 | 4/14 | open since 2026-09-29: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-29) |
| X5Y2K3 open=N3d3 stay=N Q=5 W6=off | 14% | 2.32 | 72% | 41% | -0.08% | 89/345 | 31/134 | 4/14 | open since 2026-09-21: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-21) |
| X5Y2K3 open=N3d3 stay=N Q=5 W6=on | 14% | 2.5 | 70% | 41% | -0.08% | 89/345 | 31/134 | 4/14 | open since 2026-09-21: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-21) |
| X4Y2K3 open=cap20 stay=- Q=5 W6=off | 15% | 1.02 | 80% | 40% | -2.01% | 87/345 | 30/134 | 4/14 | opens 10/08: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | none |
| X5Y2K3 open=cap10 stay=- Q=5 W6=on | 15% | 1.02 | 73% | 43% | -2.66% | 85/345 | 29/134 | 4/14 | open since 2026-09-29: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-29) |
| X4Y2K3 open=N3d1 stay=N Q=5 W6=off | 15% | 2.5 | 63% | 39% | +1.37% | 90/345 | 31/134 | 4/14 | open since 2026-09-21: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-21) |
| X5Y1K3 open=N3d1 stay=N Q=5 W6=off | 15% | 1.86 | 85% | 44% | -0.36% | 93/345 | 33/134 | 4/14 | open since 2026-09-24: chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-24) |
| X5Y1K3 open=cap20 stay=- Q=5 W6=on | 15% | 1.39 | 73% | 44% | -2.66% | 85/345 | 29/134 | 4/14 | open since 2026-09-28: chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-28) |
| X4Y2K3 open=N3d1 stay=N Q=5 W6=on | 15% | 2.97 | 62% | 39% | +1.69% | 90/345 | 31/134 | 5/14 | open since 2026-09-21: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-21) |
| X5Y1K3 open=cap10 stay=- Q=5 W6=on | 15% | 1.39 | 73% | 44% | -2.66% | 86/345 | 30/134 | 4/14 | open since 2026-09-28: chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-28) |
| X4Y2K3 open=N3d3 stay=N Q=5 W6=off | 15% | 2.88 | 68% | 38% | +0.85% | 90/345 | 31/134 | 4/14 | open since 2026-09-21: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-21) |
| X4Y1K3 open=cap20 stay=- Q=5 W6=off | 15% | 1.11 | 83% | 41% | -2.22% | 92/345 | 32/134 | 4/14 | open since 2026-09-28: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-28) |
| X5Y2K3 open=N3d1 stay=N Q=10 W6=off | 16% | 1.58 | 71% | 41% | -0.08% | 89/345 | 31/134 | 4/14 | open since 2026-09-24: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-24) |
| X5Y1K3 open=N3d1 stay=N Q=5 W6=on | 16% | 2.41 | 77% | 44% | -0.87% | 93/345 | 33/134 | 4/14 | open since 2026-09-24: chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-24) |
| X4Y2K3 open=cap20 stay=- Q=5 W6=on | 16% | 1.48 | 73% | 40% | -1.37% | 87/345 | 30/134 | 5/14 | opens 10/08: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | none |
| X3Y2K3 open=N3d1 stay=N Q=5 W6=off | 16% | 3.06 | 64% | 36% | +1.37% | 93/345 | 31/134 | 4/14 | open since 2026-09-21: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-21) |
| X5Y2K3 open=N3d1 stay=N Q=10 W6=on | 16% | 1.76 | 68% | 41% | -0.08% | 89/345 | 31/134 | 4/14 | open since 2026-09-24: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-24) |
| X4Y2K3 open=N3d3 stay=N Q=5 W6=on | 16% | 3.34 | 67% | 39% | +1.11% | 90/345 | 31/134 | 5/14 | open since 2026-09-21: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-21) |
| X5Y2K3 open=N2d1 stay=N Q=5 W6=off | 16% | 2.13 | 61% | 41% | +0.85% | 90/345 | 31/134 | 4/14 | open since 2026-09-21: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-21) |
| X5Y1K3 open=N3d3 stay=N Q=5 W6=off | 16% | 2.41 | 77% | 43% | -0.87% | 93/345 | 33/134 | 4/14 | open since 2026-09-21: chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-21) |
| X5Y2K3 open=N3d3 stay=N Q=10 W6=off | 16% | 1.76 | 74% | 41% | -1.11% | 89/345 | 31/134 | 4/14 | open since 2026-09-21: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-21) |
| X5Y2K3 open=N2d1 stay=N Q=5 W6=on | 16% | 2.32 | 60% | 41% | +0.85% | 90/345 | 31/134 | 4/14 | open since 2026-09-21: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-21) |
| X5Y2K3 open=N3d1 stay=- Q=5 W6=off | 16% | 1.3 | 79% | 42% | +0.38% | 89/345 | 31/134 | 4/14 | open since 2026-09-24: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-24) |
| X5Y2K3 open=N3d1 stay=N Q=15 W6=off | 16% | 1.48 | 69% | 41% | -0.60% | 89/345 | 31/134 | 4/14 | open since 2026-09-24: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-24) |
| X5Y2K3 open=N3d3 stay=N Q=10 W6=on | 16% | 1.95 | 71% | 41% | -1.11% | 89/345 | 31/134 | 4/14 | open since 2026-09-21: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-21) |
| X3Y2K3 open=N3d1 stay=N Q=5 W6=on | 16% | 3.71 | 60% | 36% | +1.69% | 93/345 | 31/134 | 6/14 | open since 2026-09-21: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-21) |
| X4Y1K3 open=N3d1 stay=N Q=5 W6=off | 16% | 2.13 | 65% | 40% | -0.06% | 96/345 | 33/134 | 4/14 | open since 2026-09-21: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-21) |
| X5Y2K3 open=N2d3 stay=N Q=5 W6=off | 16% | 2.32 | 64% | 41% | +0.85% | 90/345 | 31/134 | 4/14 | open since 2026-09-21: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-21) |
| X5Y2K3 open=N3d1 stay=N Q=15 W6=on | 16% | 1.67 | 67% | 41% | -0.60% | 89/345 | 31/134 | 4/14 | open since 2026-09-24: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-24) |
| X4Y2K3 open=cap10 stay=- Q=5 W6=off | 16% | 1.21 | 69% | 39% | +1.37% | 89/345 | 30/134 | 4/14 | open since 2026-09-29: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-29) |
| X3Y2K3 open=N3d3 stay=N Q=5 W6=off | 16% | 3.62 | 64% | 35% | +1.37% | 94/345 | 31/134 | 4/14 | open since 2026-09-21: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-21) |
| X3Y2K3 open=cap20 stay=- Q=5 W6=off | 16% | 1.39 | 57% | 37% | +3.39% | 91/345 | 31/134 | 4/14 | opens 10/08: ai_semis, analog_power_chips, chip_equipment_design, memory_storage, optical_connectivity | none |
| X5Y1K3 open=N3d3 stay=N Q=5 W6=on | 16% | 2.97 | 72% | 43% | -1.40% | 93/345 | 33/134 | 4/14 | open since 2026-09-21: chip_equipment_design, memory_storage, optical_connectivity | non-semis alert (since 2026-09-21) |
| X5Y2K3 open=N2d3 stay=N Q=5 W6=on | 16% | 2.5 | 63% | 41% | +0.85% | 90/345 | 31/134 | 4/14 | open since 2026-09-21: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-21) |
| X5Y2K3 open=N3d3 stay=- Q=5 W6=off | 16% | 1.39 | 80% | 41% | -0.71% | 89/345 | 31/134 | 4/14 | open since 2026-09-21: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-21) |
| X5Y2K3 open=N3d1 stay=- Q=5 W6=on | 17% | 1.48 | 75% | 42% | +0.38% | 89/345 | 31/134 | 4/14 | open since 2026-09-24: chip_equipment_design, optical_connectivity | non-semis alert (since 2026-09-24) |

## Pick: every alert (backfill for 과거 경보)

fwd 5/10/20 = primary theme (deepest dd20 among triggers) from the open day. Useful = a triggering theme fell a further >= 5% within 10 days. Release = the day the alert closed.

| # | start | release | days | trigger | all themes | warnings on | fwd5 | fwd10 | fwd20 | useful |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2019-01-29 | 2019-01-30 | 2 | ai_semis, big_tech | ai_semis, big_tech | W1, W3, W4 | +6.9% | +8.2% | +11.3% | no |
| 2 | 2021-02-23 | 2021-03-15 | 15 | ai_semis, ai_servers_network, analog_power_chips, battery_rare_earth, big_tech, chip_equipment_design, cybersecurity, memory_storage, nuclear_uranium, optical_connectivity, power_equipment, software_internet, space_comms | ai_semis, ai_servers_network, analog_power_chips, battery_rare_earth, big_tech, chip_equipment_design, cybersecurity, memory_storage, nuclear_uranium, optical_connectivity, power_equipment, software_internet, space_comms, copper_metals, defense_aerospace, gold_silver, oil_gas, power_producers, regulated_utilities | W1, W3, W7 | +2.4% | -2.7% | -8.2% | yes |
| 3 | 2022-01-19 | 2022-03-02 | 30 | ai_cloud_datacenter, ai_semis, ai_servers_network, analog_power_chips, battery_rare_earth, big_tech, chip_equipment_design, crypto, financials_payments, memory_storage, optical_connectivity, power_equipment, software_internet, space_comms | ai_cloud_datacenter, ai_semis, ai_servers_network, analog_power_chips, battery_rare_earth, big_tech, chip_equipment_design, crypto, financials_payments, memory_storage, optical_connectivity, power_equipment, software_internet, space_comms, copper_metals, power_producers, regulated_utilities, cybersecurity, nuclear_uranium, gold_silver | W2, W3, W5 | -18.3% | -14.0% | -3.6% | yes |
| 4 | 2022-03-04 | 2022-03-21 | 12 | ai_cloud_datacenter, ai_semis, analog_power_chips, big_tech, chip_equipment_design, crypto, cybersecurity, financials_payments, memory_storage, nuclear_uranium, optical_connectivity, power_equipment, software_internet | ai_cloud_datacenter, ai_semis, analog_power_chips, big_tech, chip_equipment_design, crypto, cybersecurity, financials_payments, memory_storage, nuclear_uranium, optical_connectivity, power_equipment, software_internet, ai_servers_network, battery_rare_earth, defense_aerospace, copper_metals, gold_silver, space_comms | W1, W3, W5 | -2.8% | +14.9% | +18.0% | yes |
| 5 | 2022-03-31 | 2022-08-12 | 93 | ai_semis, analog_power_chips, chip_equipment_design, crypto, memory_storage, optical_connectivity | ai_semis, analog_power_chips, chip_equipment_design, crypto, memory_storage, optical_connectivity, nuclear_uranium, ai_servers_network, battery_rare_earth, big_tech, cybersecurity, financials_payments, power_equipment, software_internet, space_comms, ai_cloud_datacenter, copper_metals, gold_silver, oil_gas, power_producers, regulated_utilities, defense_aerospace | W1, W2, W4, W5 | -10.9% | -18.7% | -36.7% | yes |
| 6 | 2022-08-22 | 2023-01-12 | 100 | ai_cloud_datacenter, ai_semis, analog_power_chips, big_tech, chip_equipment_design, crypto, cybersecurity, defense_aerospace, financials_payments, memory_storage, nuclear_uranium, optical_connectivity, power_equipment, software_internet, space_comms | ai_cloud_datacenter, ai_semis, analog_power_chips, big_tech, chip_equipment_design, crypto, cybersecurity, defense_aerospace, financials_payments, memory_storage, nuclear_uranium, optical_connectivity, power_equipment, software_internet, space_comms, ai_servers_network, gold_silver, battery_rare_earth, copper_metals, oil_gas, regulated_utilities, power_producers | W1, W4, W5, W6 | -4.7% | -11.1% | -8.1% | yes |
| 7 | 2023-02-17 | 2023-07-14 | 101 | ai_semis, analog_power_chips, chip_equipment_design, cybersecurity, gold_silver, memory_storage, oil_gas, optical_connectivity, software_internet | ai_semis, analog_power_chips, chip_equipment_design, cybersecurity, gold_silver, memory_storage, oil_gas, optical_connectivity, software_internet, ai_cloud_datacenter, crypto, financials_payments, power_producers, space_comms, copper_metals, regulated_utilities, ai_servers_network, battery_rare_earth, nuclear_uranium, power_equipment, big_tech, defense_aerospace | W2, W4, W5 | -4.3% | -1.4% | +9.4% | yes |
| 8 | 2023-07-27 | 2023-08-25 | 22 | battery_rare_earth, big_tech, gold_silver, optical_connectivity, power_equipment, software_internet, space_comms | battery_rare_earth, big_tech, gold_silver, optical_connectivity, power_equipment, software_internet, space_comms | W3, W4, W5 | +1.2% | +0.9% | -8.2% | yes |
| 9 | 2026-02-06 | 2026-02-23 | 11 | big_tech | big_tech | W1, W5, W7 | -4.0% | -3.6% | -1.8% | no |
| 10 | 2026-03-27 | 2026-04-07 | 7 | ai_cloud_datacenter, ai_semis, ai_servers_network, analog_power_chips, big_tech, chip_equipment_design, crypto, defense_aerospace, financials_payments, memory_storage, nuclear_uranium, optical_connectivity, power_equipment, software_internet, space_comms | ai_cloud_datacenter, ai_semis, ai_servers_network, analog_power_chips, big_tech, chip_equipment_design, crypto, defense_aerospace, financials_payments, memory_storage, nuclear_uranium, optical_connectivity, power_equipment, software_internet, space_comms | W2, W3, W5 | +4.1% | +8.2% | +25.5% | yes |
| 11 | 2026-10-08 | open | 7 | ai_cloud_datacenter, ai_semis, analog_power_chips, battery_rare_earth, chip_equipment_design, copper_metals, crypto, memory_storage, nuclear_uranium, optical_connectivity, power_equipment, space_comms | ai_cloud_datacenter, ai_semis, analog_power_chips, battery_rare_earth, chip_equipment_design, copper_metals, crypto, memory_storage, nuclear_uranium, optical_connectivity, power_equipment, space_comms, ai_servers_network, cybersecurity, power_producers | W1, W2, W3, W4, W6 | +0.2% | - | - | yes |

Note: warnings listed include W6 when on for a trigger theme, but the pick does not count W6.

Files: `bt2/breadth.py` (backtest), `bt2/report3.py` (this report), `bt2/results3.json` (every setting, the pick's alerts, frontier).
