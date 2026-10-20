# Surge-signal backtest (risk-signal part 2-b)

Research only; nothing in the repo changed. Window 2016-01-04..2026-10-16 (10.78 yrs, 2713 trading days), 22 themes (defensives_other excluded; theme-days with <3 members invalid), plus ^SOX. `surge.py` imports `backtest.py` unchanged. Grid: the brief's 256 settings extended with M = 5 -> 384 settings, each scored under 4 banner gates.

## Headline

- **No setting in the brief's grid (M <= 4) gets the banner to <= 20%** under any gate. 'Any theme' banner: 81%-97% of days; cap-20% gate: >= 27%; >= 3 themes: >= 48%. Only M = 5 (all five components on the same day) with a gate gets there.
- The edge is modest: the pick's shown events reach +5% within 10d 39% of the time vs a 32% base rate, and recall of +15% rallies before their half-way point is low (5%).

## Pick (precision first, brief gate `cap20`)

**n10 k3 Z2.0 P5 U4 B60 R60 M5**, banner gate cap20 (themes in surge hold >= 20% of watchlist cap, or ^SOX in surge): EMA n=10, accel lag k=3, Z >= 2.0, accel top 5%, >= 4/5 up days, breadth >= 60%, RSI cross 60, all 5 components on.

- Theme events (ungated lifecycle): 172 = 16.0/yr total, 0.73/yr per theme, mean 13.8 trading days.
- Banner up **7%** of trading days, 1.0 openings/yr; events shown under it 46 (4.3/yr). Ungated any-theme banner for the same setting: 46%.
- Shown events: useful (+5% further within 10d) **39%** vs base **32%**; false starts (any close below start within 10d) 70% vs base 78%; fwd5/10/20 +1.8% / +4.6% / +7.5% vs base +0.5% / +1.0% / +2.1%.
- All theme events (ungated): useful 38%, false 77%, fwd10 +2.6%.
- Recall: **27/591** (5%) theme rallies caught by a shown event; ungated 79/591. ^SOX alone: 6 events, useful 33%, recall 3/34.

Rule: gate cap20, banner <= 20%, >= 1.5 shown events/yr; maximise shown-event useful share, then recall. Where B60 and B70 tie, B60 (the brief's default) is listed.

## Method

- Magnitude: 5d return / (stdev of the 60 daily returns ending 5 days earlier x sqrt 5); the window excludes the move itself.
- Accel: slope = EMA_n(t)/EMA_n(t-1)-1 (%); accel = slope_t - slope_{t-k}; on when >= the (1-P) quantile of the previous 250 accel values (min 120).
- Persistence: up days in last 5 >= U. Breadth: share of members with data whose 5d return > 0 >= B (^SOX: union of the 5 semis themes' members).
- RSI: Wilder 14; crossed up through R within the last 5 days and now R..80. Overheated (> 80) reported separately.
- Event: starts on a signal day after >= 10 signal-off days with no open event; ends on a close below EMA_n or 10 trading days without a new 20d high.
- Banner gates: `any` = any theme in an event; `cap20`/`cap30` = themes in events hold >= 20/30% of watchlist cap (shares x close, 250 tickers) or ^SOX in an event; `N3` = >= 3 themes in events. An event is *shown* when its gate is up on its start day; useful/fwd/recall per gate use shown events only.
- Useful = max close in the next 10 days >= +5% over the start close. Base = every valid theme-day in the window.
- Recall: rally = trough-to-peak >= +15% within 60 days, de-duplicated; caught if a (shown) event starts in [trough-5d, first day half the gain is reached].

## Best settings per gate (banner <= 20%, >= 1.5 shown/yr)

| setting | banner gate | banner up | openings/yr | shown events/yr | useful | false start | fwd5 | fwd10 | fwd20 | recall |
|---|---|---|---|---|---|---|---|---|---|---|
| (none) | any | | | | | | | | | |
| n10 k3 Z2.0 P5 U4 B60 R60 M5 | cap20 | 7% | 1.0 | 4.3 | 39% | 70% | +1.8% | +4.6% | +7.5% | 27/591 |
| n10 k3 Z2.0 P5 U4 B70 R60 M5 | cap20 | 7% | 1.0 | 4.3 | 39% | 70% | +1.7% | +4.6% | +7.4% | 27/591 |
| n20 k3 Z2.0 P5 U4 B60 R60 M5 | cap20 | 11% | 1.0 | 5.0 | 39% | 70% | +1.6% | +3.4% | +5.7% | 28/591 |
| n20 k3 Z2.0 P5 U4 B70 R60 M5 | cap20 | 11% | 1.0 | 5.0 | 39% | 70% | +1.5% | +3.4% | +5.7% | 28/591 |
| n10 k3 Z2.0 P5 U3 B60 R60 M5 | cap20 | 9% | 1.2 | 5.6 | 38% | 70% | +1.7% | +4.4% | +7.2% | 34/591 |
| n10 k3 Z2.0 P5 U4 B60 R60 M5 | cap30 | 7% | 1.1 | 4.1 | 41% | 68% | +1.9% | +4.8% | +7.7% | 26/591 |
| n10 k3 Z2.0 P5 U4 B70 R60 M5 | cap30 | 7% | 1.1 | 4.1 | 41% | 68% | +1.8% | +4.8% | +7.7% | 26/591 |
| n10 k3 Z2.0 P5 U3 B60 R60 M5 | cap30 | 7% | 1.2 | 4.6 | 40% | 70% | +2.0% | +5.0% | +7.8% | 28/591 |
| n20 k3 Z2.0 P5 U3 B60 R60 M5 | cap30 | 11% | 1.0 | 5.4 | 40% | 67% | +1.8% | +4.0% | +6.2% | 30/591 |
| n20 k3 Z2.0 P5 U4 B60 R60 M5 | cap30 | 10% | 0.9 | 4.9 | 40% | 70% | +1.7% | +3.6% | +6.0% | 28/591 |
| n10 k3 Z2.0 P10 U3 B70 R55 M5 | N3 | 19% | 4.5 | 15.0 | 39% | 75% | +0.7% | +2.6% | +5.7% | 84/591 |
| n10 k3 Z2.0 P5 U3 B70 R55 M5 | N3 | 12% | 3.5 | 9.4 | 39% | 76% | +0.7% | +2.2% | +5.4% | 52/591 |
| n10 k3 Z2.0 P5 U3 B60 R55 M5 | N3 | 12% | 3.5 | 9.6 | 38% | 76% | +0.7% | +2.2% | +5.3% | 52/591 |
| n10 k3 Z2.0 P10 U4 B60 R55 M5 | N3 | 17% | 4.1 | 13.4 | 37% | 72% | +0.7% | +2.3% | +5.3% | 75/591 |
| n10 k3 Z2.0 P10 U4 B70 R55 M5 | N3 | 16% | 3.8 | 12.5 | 37% | 74% | +0.6% | +2.4% | +5.4% | 71/591 |

Closest the brief's grid (M <= 4) gets: lowest banner per gate:

| setting | banner gate | banner up | openings/yr | shown events/yr | useful | false start | fwd5 | fwd10 | fwd20 | recall |
|---|---|---|---|---|---|---|---|---|---|---|
| n10 k3 Z2.0 P5 U4 B70 R60 M4 | any | 81% | 6.7 | 59.4 | 33% | 78% | +0.6% | +1.5% | +3.2% | 253/591 |
| n10 k3 Z2.0 P5 U4 B70 R60 M4 | cap20 | 27% | 4.9 | 25.8 | 29% | 76% | +0.6% | +1.8% | +3.7% | 119/591 |
| n10 k3 Z2.0 P5 U4 B70 R60 M4 | cap30 | 21% | 4.7 | 21.1 | 29% | 77% | +0.7% | +2.0% | +4.1% | 98/591 |
| n10 k3 Z2.0 P5 U4 B70 R60 M4 | N3 | 48% | 9.2 | 45.3 | 32% | 77% | +0.7% | +1.7% | +3.4% | 197/591 |

## Parameter effects (grid means, gate cap20)

| param | value | events/yr | banner cap20 | useful (shown) | recall (shown) |
|---|---|---|---|---|---|
| n | 10 | 100.9 | 40% | 31% | 41% |
| n | 20 | 98.1 | 51% | 31% | 44% |
| k | 3 | 93.9 | 44% | 31% | 39% |
| k | 5 | 105.1 | 48% | 30% | 45% |
| Z | 1.5 | 107.7 | 50% | 30% | 47% |
| Z | 2.0 | 91.2 | 42% | 32% | 38% |
| P | 10 | 106.0 | 49% | 30% | 45% |
| P | 5 | 92.9 | 43% | 31% | 40% |
| U | 3 | 102.6 | 46% | 31% | 44% |
| U | 4 | 96.3 | 46% | 30% | 41% |
| B | 60 | 99.9 | 46% | 31% | 42% |
| B | 70 | 99.1 | 46% | 31% | 42% |
| R | 55 | 102.0 | 47% | 31% | 44% |
| R | 60 | 97.0 | 45% | 30% | 40% |
| M | 3 | 159.1 | 64% | 29% | 68% |
| M | 4 | 99.3 | 51% | 30% | 45% |
| M | 5 | 40.1 | 22% | 33% | 14% |

## Which components help (at the pick, gate cap20)

| variant | events/yr | banner up | shown/yr | useful | false | fwd10 | recall |
|---|---|---|---|---|---|---|---|
| pick: all 5 on | 16.0 | 7% | 4.3 | 39% | 70% | +4.6% | 27 |
| without mag, 4 of 4 | 30.1 | 14% | 8.8 | 32% | 73% | +2.8% | 45 |
| without mag, 3 of 4 | 145.6 | 60% | 107.5 | 28% | 80% | +0.8% | 353 |
| without accel, 4 of 4 | 42.4 | 18% | 16.4 | 29% | 73% | +2.6% | 68 |
| without accel, 3 of 4 | 132.8 | 56% | 95.3 | 26% | 80% | +1.0% | 307 |
| without pers, 4 of 4 | 19.3 | 9% | 5.7 | 39% | 69% | +4.7% | 36 |
| without pers, 3 of 4 | 69.9 | 33% | 36.6 | 32% | 75% | +1.9% | 157 |
| without breadth, 4 of 4 | 16.3 | 7% | 4.3 | 39% | 70% | +4.6% | 27 |
| without breadth, 3 of 4 | 61.5 | 27% | 26.5 | 28% | 75% | +1.7% | 118 |
| without rsi, 4 of 4 | 25.8 | 12% | 8.2 | 32% | 75% | +2.3% | 45 |
| without rsi, 3 of 4 | 93.1 | 39% | 53.9 | 37% | 76% | +1.5% | 239 |

Read-out: removing mag, accel or rsi lowers useful to ~29%-32% (they carry the precision). Breadth is redundant at the pick (without it: 46 vs 46 shown events). Dropping persistence keeps useful at 39% and raises recall 27 -> 36 with banner 9%: a simpler 4-component equivalent (mag + accel + breadth + rsi, all on).

Each component alone at the pick's parameters (share of theme-days on; useful from that day; base 32%):

| component | on share | useful |
|---|---|---|
| mag | 3% | 33% |
| accel | 6% | 40% |
| pers | 22% | 27% |
| breadth | 47% | 30% |
| rsi | 15% | 27% |

Overheated (RSI > 80): 1% of theme-days; fwd10 +0.3%, fwd20 +1.7%, useful 26% (base fwd10 +1.0%, fwd20 +2.1%, useful 32%).

## Per theme (pick)

| theme | events | /yr | shown (cap20) | useful (all) | rallies caught (all) |
|---|---|---|---|---|---|
| ai_cloud_datacenter | 9 | 0.8 | 3 | 44% | 1/22 |
| ai_semis | 4 | 0.4 | 4 | 25% | 3/32 |
| ai_servers_network | 7 | 0.6 | 4 | 29% | 5/25 |
| analog_power_chips | 4 | 0.4 | 1 | 25% | 3/31 |
| battery_rare_earth | 7 | 0.6 | 1 | 29% | 3/33 |
| big_tech | 5 | 0.5 | 5 | 20% | 2/28 |
| chip_equipment_design | 10 | 0.9 | 5 | 60% | 3/34 |
| copper_metals | 8 | 0.7 | 1 | 38% | 2/28 |
| crypto | 4 | 0.4 | 1 | 100% | 4/20 |
| cybersecurity | 12 | 1.1 | 2 | 42% | 6/30 |
| defense_aerospace | 8 | 0.7 | 2 | 12% | 2/13 |
| financials_payments | 5 | 0.5 | 2 | 0% | 1/16 |
| gold_silver | 11 | 1.0 | 1 | 36% | 9/28 |
| memory_storage | 8 | 0.7 | 1 | 62% | 4/33 |
| nuclear_uranium | 16 | 1.5 | 1 | 44% | 8/33 |
| oil_gas | 7 | 0.6 | 4 | 29% | 3/20 |
| optical_connectivity | 10 | 0.9 | 4 | 30% | 5/37 |
| power_equipment | 8 | 0.7 | 1 | 25% | 6/28 |
| power_producers | 9 | 0.8 | 0 | 62% | 2/27 |
| regulated_utilities | 4 | 0.4 | 0 | 0% | 1/11 |
| software_internet | 6 | 0.6 | 2 | 50% | 1/31 |
| space_comms | 10 | 0.9 | 1 | 40% | 5/31 |
| ^SOX | 6 | 0.6 | 6 | 33% | 3/34 |

## 2026

^SOX Aug-Oct 2026 peak close: **2026-10-06**. Semis-family +15% rallies peaking in 2026:

- ai_semis: trough 2025-12-17, half 2025-12-23, peak 2026-02-25, +16%
- ai_semis: trough 2026-03-30, half 2026-04-24, peak 2026-06-02, +66%
- ai_semis: trough 2026-06-10, half 2026-06-15, peak 2026-06-18, +16%
- ai_semis: trough 2026-07-29, half 2026-08-05, peak 2026-10-06, +26%
- analog_power_chips: trough 2025-11-20, half 2026-01-06, peak 2026-02-11, +49%
- analog_power_chips: trough 2026-03-30, half 2026-04-23, peak 2026-06-22, +75%
- analog_power_chips: trough 2026-09-01, half 2026-09-25, peak 2026-10-06, +17%
- chip_equipment_design: trough 2025-11-20, half 2026-01-05, peak 2026-01-29, +50%
- chip_equipment_design: trough 2026-03-30, half 2026-05-26, peak 2026-06-22, +76%
- chip_equipment_design: trough 2026-06-24, half 2026-06-29, peak 2026-06-30, +16%
- chip_equipment_design: trough 2026-07-29, half 2026-08-04, peak 2026-10-02, +25%
- memory_storage: trough 2025-11-20, half 2026-01-06, peak 2026-02-02, +104%
- memory_storage: trough 2026-03-30, half 2026-05-11, peak 2026-06-22, +247%
- memory_storage: trough 2026-07-29, half 2026-08-13, peak 2026-10-01, +43%
- optical_connectivity: trough 2025-12-17, half 2026-02-06, peak 2026-03-02, +57%
- optical_connectivity: trough 2026-03-06, half 2026-04-17, peak 2026-06-02, +102%
- optical_connectivity: trough 2026-06-09, half 2026-06-15, peak 2026-06-22, +16%
- optical_connectivity: trough 2026-07-29, half 2026-08-04, peak 2026-10-06, +55%
- ^SOX: trough 2025-11-20, half 2025-12-08, peak 2026-01-29, +31%
- ^SOX: trough 2026-03-30, half 2026-05-05, peak 2026-06-22, +105%
- ^SOX: trough 2026-07-29, half 2026-08-04, peak 2026-10-06, +27%

2026 events (all themes, pick):

| theme | start | end | shown (cap20) | fwd5 | fwd10 | fwd20 | run-up 10d |
|---|---|---|---|---|---|---|---|
| oil_gas | 2026-01-05 | 2026-01-07 | no | -1.2% | +1.7% | +10.7% | +2.6% |
| space_comms | 2026-01-06 | 2026-01-26 | no | -1.6% | +2.1% | -7.8% | +11.4% |
| ^SOX | 2026-04-08 | 2026-05-18 | yes | +8.6% | +16.4% | +34.8% | +16.4% |
| ai_servers_network | 2026-04-08 | 2026-04-28 | yes | +1.8% | +14.7% | +14.1% | +14.7% |
| chip_equipment_design | 2026-04-10 | 2026-04-28 | yes | +2.1% | +5.7% | +11.0% | +5.7% |
| ai_cloud_datacenter | 2026-04-14 | 2026-04-28 | yes | +7.1% | -0.2% | +11.0% | +10.2% |
| big_tech | 2026-04-15 | 2026-05-19 | yes | +1.8% | +1.6% | +7.0% | +1.8% |
| ai_cloud_datacenter | 2026-05-06 | 2026-05-18 | yes | -3.3% | -5.4% | -1.4% | -0.8% |
| cybersecurity | 2026-05-07 | 2026-06-08 | yes | +11.0% | +21.5% | +31.9% | +21.5% |
| ai_servers_network | 2026-05-14 | 2026-06-05 | yes | +1.1% | +17.4% | +16.4% | +17.4% |
| oil_gas | 2026-05-15 | 2026-05-26 | yes | +0.2% | -4.7% | -5.5% | +2.9% |
| software_internet | 2026-05-29 | 2026-06-05 | no | -6.0% | -12.9% | -10.6% | +6.2% |
| chip_equipment_design | 2026-06-15 | 2026-06-23 | no | -3.7% | +11.2% | -7.9% | +11.2% |
| power_equipment | 2026-06-22 | 2026-06-26 | no | -7.4% | -11.5% | -12.2% | -2.6% |
| defense_aerospace | 2026-07-27 | 2026-08-13 | no | +1.3% | +2.5% | -4.4% | +3.3% |
| gold_silver | 2026-08-07 | 2026-08-31 | no | +0.5% | +16.2% | +11.7% | +16.2% |
| copper_metals | 2026-08-21 | 2026-08-31 | no | -1.9% | -4.9% | -8.2% | +2.1% |
| crypto | 2026-08-21 | 2026-09-10 | no | -1.3% | +11.8% | +18.1% | +14.1% |
| power_producers | 2026-10-07 | 2026-10-14 | no | -6.9% | - | - | -1.1% |

Semis family, 2026-10-01..10-16 (signal-on days; components on 10/08):

- ai_semis: on never; 10/08 [] RSI 56.0
- analog_power_chips: on never; 10/08 [] RSI 56.0
- chip_equipment_design: on never; 10/08 [] RSI 55.1
- memory_storage: on never; 10/08 [] RSI 47.8
- optical_connectivity: on never; 10/08 [] RSI 56.6
- ^SOX: on never; 10/08 [] RSI 53.9

## Every pick event from 2024 (`shown` = cap20 banner up on the start day)

| theme | start | end | days | shown | fwd5 | fwd10 | fwd20 | run-up 10d |
|---|---|---|---|---|---|---|---|---|
| cybersecurity | 2024-01-10 | 2024-01-31 | 15 | no | +1.4% | +4.7% | +12.6% | +6.1% |
| nuclear_uranium | 2024-01-12 | 2024-01-25 | 9 | no | -4.6% | -2.5% | -5.2% | -0.6% |
| ^SOX | 2024-01-22 | 2024-01-30 | 7 | yes | +0.0% | +0.0% | +1.6% | +2.2% |
| chip_equipment_design | 2024-01-22 | 2024-03-11 | 35 | yes | +4.9% | +6.5% | +9.8% | +6.5% |
| memory_storage | 2024-01-22 | 2024-01-30 | 7 | yes | +0.5% | -1.5% | -6.6% | +1.1% |
| optical_connectivity | 2024-01-22 | 2024-02-13 | 17 | yes | +1.0% | +0.5% | +0.3% | +1.0% |
| power_equipment | 2024-02-02 | 2024-02-20 | 12 | no | +2.8% | +1.4% | +10.9% | +2.8% |
| crypto | 2024-02-09 | 2024-03-19 | 27 | no | +18.7% | +30.5% | +84.0% | +30.5% |
| memory_storage | 2024-02-26 | 2024-03-13 | 13 | no | +11.3% | +8.8% | +24.2% | +13.3% |
| battery_rare_earth | 2024-02-29 | 2024-03-05 | 4 | no | -7.0% | -7.3% | -2.1% | +2.6% |
| memory_storage | 2024-03-21 | 2024-04-12 | 16 | no | +5.5% | +9.5% | -3.3% | +12.0% |
| optical_connectivity | 2024-03-25 | 2024-04-01 | 5 | no | -4.5% | -4.5% | -10.3% | -1.7% |
| nuclear_uranium | 2024-04-02 | 2024-04-09 | 6 | no | -1.8% | -3.6% | -5.4% | +3.8% |
| defense_aerospace | 2024-04-29 | 2024-05-23 | 19 | no | +1.3% | +1.3% | +2.1% | +2.8% |
| space_comms | 2024-05-20 | 2024-05-22 | 3 | no | -6.8% | +1.0% | +2.7% | +1.6% |
| financials_payments | 2024-07-17 | 2024-07-19 | 3 | no | -4.3% | -1.5% | -4.2% | -1.5% |
| space_comms | 2024-07-26 | 2024-08-02 | 6 | no | -6.2% | +3.3% | +27.1% | +5.0% |
| nuclear_uranium | 2024-09-24 | 2024-10-31 | 28 | no | +3.5% | +9.4% | +29.2% | +11.0% |
| memory_storage | 2024-09-26 | 2024-10-10 | 11 | no | -5.3% | -2.8% | -2.8% | -2.1% |
| cybersecurity | 2024-10-10 | 2024-10-23 | 10 | no | -0.8% | -2.8% | +3.6% | +1.2% |
| regulated_utilities | 2024-10-16 | 2024-10-25 | 8 | no | +0.8% | -3.8% | -4.9% | +0.8% |
| oil_gas | 2024-11-06 | 2024-11-25 | 14 | no | +0.8% | +2.4% | -0.9% | +2.4% |
| ai_cloud_datacenter | 2024-11-07 | 2024-11-15 | 7 | yes | -0.1% | +3.1% | +4.9% | +3.1% |
| ai_servers_network | 2024-11-07 | 2024-11-14 | 6 | yes | -4.6% | -1.3% | +2.9% | -1.3% |
| big_tech | 2024-11-07 | 2024-11-15 | 7 | yes | +0.4% | -1.0% | +8.0% | +1.0% |
| cybersecurity | 2024-11-07 | 2024-11-27 | 15 | yes | +3.6% | +6.3% | +9.5% | +6.3% |
| optical_connectivity | 2024-11-07 | 2024-11-15 | 7 | yes | -4.1% | +1.5% | +16.6% | +3.9% |
| power_equipment | 2024-11-07 | 2024-12-09 | 22 | yes | -1.2% | +4.6% | +4.3% | +4.6% |
| software_internet | 2024-11-07 | 2024-12-10 | 23 | yes | +6.0% | +7.8% | +17.3% | +7.8% |
| crypto | 2024-11-08 | 2024-11-26 | 13 | yes | +18.4% | +36.0% | +26.8% | +47.5% |
| power_producers | 2025-01-06 | 2025-01-27 | 14 | no | +5.6% | +18.4% | +10.8% | +18.4% |
| financials_payments | 2025-01-17 | 2025-02-20 | 23 | no | +2.5% | +3.4% | +6.2% | +4.3% |
| defense_aerospace | 2025-01-21 | 2025-02-06 | 13 | no | -0.8% | -0.5% | -0.3% | +1.4% |
| nuclear_uranium | 2025-01-21 | 2025-01-27 | 5 | no | -8.8% | -2.0% | -8.3% | +8.9% |
| ai_cloud_datacenter | 2025-01-22 | 2025-01-27 | 4 | no | -10.9% | -6.0% | -3.4% | +1.2% |
| analog_power_chips | 2025-02-19 | 2025-02-27 | 7 | no | -2.4% | -4.3% | -10.3% | +2.2% |
| defense_aerospace | 2025-03-19 | 2025-03-28 | 8 | no | +0.3% | -1.0% | -4.0% | +1.5% |
| gold_silver | 2025-04-11 | 2025-04-23 | 8 | no | +2.4% | -1.1% | -8.1% | +3.2% |
| gold_silver | 2025-08-06 | 2025-08-19 | 10 | no | +0.3% | +0.3% | +10.4% | +1.3% |
| battery_rare_earth | 2025-08-08 | 2025-08-20 | 9 | no | +5.7% | +3.0% | +0.3% | +6.3% |
| optical_connectivity | 2025-09-08 | 2025-09-24 | 13 | no | +7.9% | +10.5% | +8.0% | +12.3% |
| ai_cloud_datacenter | 2025-09-11 | 2025-09-25 | 11 | no | -2.3% | -2.7% | +1.5% | +7.1% |
| cybersecurity | 2025-09-19 | 2025-10-03 | 11 | no | -3.1% | -1.6% | -3.1% | -0.2% |
| space_comms | 2025-10-02 | 2025-10-21 | 14 | no | +25.6% | +26.8% | +16.7% | +32.1% |
| gold_silver | 2025-11-12 | 2025-11-20 | 7 | no | -2.9% | +2.4% | +8.0% | +2.4% |
| analog_power_chips | 2025-12-03 | 2025-12-17 | 11 | no | +0.9% | -3.1% | -1.5% | +1.3% |
| oil_gas | 2026-01-05 | 2026-01-07 | 3 | no | -1.2% | +1.7% | +10.7% | +2.6% |
| space_comms | 2026-01-06 | 2026-01-26 | 14 | no | -1.6% | +2.1% | -7.8% | +11.4% |
| ^SOX | 2026-04-08 | 2026-05-18 | 29 | yes | +8.6% | +16.4% | +34.8% | +16.4% |
| ai_servers_network | 2026-04-08 | 2026-04-28 | 15 | yes | +1.8% | +14.7% | +14.1% | +14.7% |
| chip_equipment_design | 2026-04-10 | 2026-04-28 | 13 | yes | +2.1% | +5.7% | +11.0% | +5.7% |
| ai_cloud_datacenter | 2026-04-14 | 2026-04-28 | 11 | yes | +7.1% | -0.2% | +11.0% | +10.2% |
| big_tech | 2026-04-15 | 2026-05-19 | 25 | yes | +1.8% | +1.6% | +7.0% | +1.8% |
| ai_cloud_datacenter | 2026-05-06 | 2026-05-18 | 9 | yes | -3.3% | -5.4% | -1.4% | -0.8% |
| cybersecurity | 2026-05-07 | 2026-06-08 | 22 | yes | +11.0% | +21.5% | +31.9% | +21.5% |
| ai_servers_network | 2026-05-14 | 2026-06-05 | 16 | yes | +1.1% | +17.4% | +16.4% | +17.4% |
| oil_gas | 2026-05-15 | 2026-05-26 | 7 | yes | +0.2% | -4.7% | -5.5% | +2.9% |
| software_internet | 2026-05-29 | 2026-06-05 | 6 | no | -6.0% | -12.9% | -10.6% | +6.2% |
| chip_equipment_design | 2026-06-15 | 2026-06-23 | 6 | no | -3.7% | +11.2% | -7.9% | +11.2% |
| power_equipment | 2026-06-22 | 2026-06-26 | 5 | no | -7.4% | -11.5% | -12.2% | -2.6% |
| defense_aerospace | 2026-07-27 | 2026-08-13 | 14 | no | +1.3% | +2.5% | -4.4% | +3.3% |
| gold_silver | 2026-08-07 | 2026-08-31 | 17 | no | +0.5% | +16.2% | +11.7% | +16.2% |
| copper_metals | 2026-08-21 | 2026-08-31 | 7 | no | -1.9% | -4.9% | -8.2% | +2.1% |
| crypto | 2026-08-21 | 2026-09-10 | 14 | no | -1.3% | +11.8% | +18.1% | +14.1% |
| power_producers | 2026-10-07 | 2026-10-14 | 6 | no | -6.9% | - | - | -1.1% |

## Informational: yesterday's top-5 watchlist gainers, next day

2712 days: top-5 next-day mean +0.146% (median of daily means -0.132%) vs all names +0.121%. Share up next day: top-5 45% vs all 51%.