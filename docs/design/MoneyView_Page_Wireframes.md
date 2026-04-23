# MoneyView Page Wireframes

> Structural wireframes for all five tabs and three modal types.

---

## 1. Market Overview (Scanner)

**Route**: `/` | **Mode**: Fast macro scan

```
┌─ PageHeader ──────────────────────────────────────────┐
│ Market Overview                                       │
│ Real-time snapshot of major global and domestic indices│
└───────────────────────────────────────────────────────┘

┌─ DashboardControlBar ─────────────────────────────────┐
│ Market Dashboard    [info]          [Chart ⟷ Table]   │
└───────────────────────────────────────────────────────┘

┌─ MainContent ─────────────────────────────────────────┐
│                                                       │
│  CHART VIEW: CardGrid (3–4 cols)                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│  │ Name    │ │ Name    │ │ Name    │ │ Name    │    │
│  │ Ticker  │ │ Ticker  │ │ Ticker  │ │ Ticker  │    │
│  │ ██ Value│ │ ██ Value│ │ ██ Value│ │ ██ Value│    │
│  │ ▲+1.2%  │ │ ▼-0.8%  │ │ ▲+0.3%  │ │ ▼-2.1%  │    │
│  │ ~spark~ │ │ ~spark~ │ │ ~spark~ │ │ ~spark~ │    │
│  │ src/time│ │ src/time│ │ src/time│ │ src/time│    │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘    │
│                                                       │
│  TABLE VIEW: DenseTable                               │
│  Instrument | Current | Abs Δ | % Δ | Source          │
│  ─────────────────────────────────────────────        │
│  KOSPI      | 2,634   | +12   | ▲+0.5% | KRX         │
│  S&P 500    | 5,123   | -45   | ▼-0.9% | Yahoo       │
│                                                       │
└───────────────────────────────────────────────────────┘

→ Card click / row click opens Market Detail Modal
```

**Visual hierarchy**: value → delta → sparkline → source
**Design rule**: Fast and light. No heavy controls.

---

## 2. Portfolio (Operator)

**Route**: `/portfolio` | **Mode**: Control + review surface

```
┌─ PageHeader ──────────────────────────────────────────┐
│ Portfolio                                             │
└───────────────────────────────────────────────────────┘

┌─ TopAnalysisZone ─────────────────────────────────────┐
│ ┌─ SnapshotSummary ──────────────────────────────┐    │
│ │ As-of: 2024-12-15  Universe: KOSPI200  v3      │    │
│ │ Benchmark: ^KS11   Positive spread: 8/12       │    │
│ │ [Refresh] [Save Snapshot] [History] [Full View] │    │
│ └────────────────────────────────────────────────┘    │
│                                                       │
│ ┌─ Attribution KPIs (MetricGrid 4-col) ──────────┐    │
│ │ Portfolio  │ Benchmark │ Active    │ Beta       │    │
│ │ +12.3%     │ +8.7%     │ +3.6%    │ 1.12       │    │
│ └────────────────────────────────────────────────┘    │
│                                                       │
│ ┌─ Attribution Visuals ──────────────────────────┐    │
│ │ [AllocationDonut]    [AttributionWaterfall]     │    │
│ └────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────┘

┌─ HoldingsZone ────────────────────────────────────────┐
│ Holdings         [Card ⟷ Table] [Add] [Sync]         │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                  │
│ │ AAPL │ │ MSFT │ │ TSLA │ │ NVDA │   (card view)    │
│ └──────┘ └──────┘ └──────┘ └──────┘                  │
│                                                       │
│ → Click opens Stock Detail Modal                      │
└───────────────────────────────────────────────────────┘

┌─ AllocationZone ──────────────────────────────────────┐
│ Allocation Model   Tracked: 12  Allocated: 8         │
│ Invested: 85%  Cash: 15%                              │
│ ┌────────────────────────────────────────────────┐    │
│ │ Ticker │ Name     │ Saved Wt │ Edit Wt │ Save │    │
│ │ AAPL   │ Apple    │ 15%      │ [___]   │ [✓]  │    │
│ └────────────────────────────────────────────────┘    │
│ [Normalize to 100%]  [Apply to Snapshot]              │
└───────────────────────────────────────────────────────┘
```

**Visual hierarchy**: review state → attribution → holdings → allocation → persistence
**Design rule**: Controllable and traceable. Live vs snapshot visually separated.

---

## 3. Corporate Analysis (Modeler)

**Route**: `/corporate` | **Mode**: Single-company modeling desk

```
┌─ PageHeader ──────────────────────────────────────────┐
│ Corporate Analysis                                    │
│ [Company Search ▾]  [Backend DCF] [Refresh] [+ Add]  │
└───────────────────────────────────────────────────────┘

┌─ MainGrid ────────────────────────────────────────────┐
│ ┌─ LeftColumn (35%) ─────┐ ┌─ RightColumn (65%) ───┐ │
│ │ Realtime Assumptions   │ │ KPI Row (MetricGrid)  │ │
│ │ ┌──────────────────┐   │ │ ROIC-WACC │ Ke │ Beta │ │
│ │ │ Growth Basis [▾] │   │ │ +4.2%     │8.1%│1.12  │ │
│ │ │ Growth Rate [━━] │   │ │                       │ │
│ │ │ ROIC      [━━━]  │   │ │ Diagnostics Board     │ │
│ │ │ WACC      [━━━]  │   │ │ ┌─────┐ ┌─────┐      │ │
│ │ │ Debt Ratio[━━━]  │   │ │ │Stat │ │Hurdl│      │ │
│ │ │ Beta      [━━━]  │   │ │ │Graph│ │Rate │      │ │
│ │ │ CRP       [━━━]  │   │ │ └─────┘ └─────┘      │ │
│ │ │ ...more sliders   │   │ │ ┌─────┐ ┌─────┐      │ │
│ │ └──────────────────┘   │ │ │Beta │ │Value│      │ │
│ │                        │ │ │Curve│ │Drvr │      │ │
│ │ Refresh State          │ │ └─────┘ └─────┘      │ │
│ │ Last: 10:32  [Stale]   │ │                       │ │
│ │ [Refresh Source Data]  │ │ → KPI click opens     │ │
│ │                        │ │   Calc Detail Modal   │ │
│ └────────────────────────┘ └───────────────────────┘ │
└───────────────────────────────────────────────────────┘

┌─ BottomComparisonZone ────────────────────────────────┐
│ Target Stock Comparison                               │
│ Universe: [▾]  Benchmark: [▾]  Sort: [▾]  [Refresh]  │
│ ┌────────────────────────────────────────────────┐    │
│ │ Ticker│ROIC-WACC│DCF Val│Price│DCF Ret│Spread │    │
│ │ ────────────────────────────────────────────── │    │
│ │ AAPL  │ +4.2%   │ 195   │ 178 │ +9.6% │ +3.2% │    │
│ └────────────────────────────────────────────────┘    │
│ [Open Portfolio Testing]                              │
└───────────────────────────────────────────────────────┘
```

**Visual hierarchy**: ticker identity → assumptions → KPIs → diagnostics → comparison
**Design rule**: Modeling desk. Strong input/output split.

---

## 4. Monte Carlo (Lab)

**Route**: `/monte-carlo` | **Mode**: Simulation experiments

```
┌─ PageHeaderCard ──────────────────────────────────────┐
│ Monte Carlo investment analysis                       │
│ Simulation Lab                                        │
│ Five-tab workflow for uncertainty analysis             │
└───────────────────────────────────────────────────────┘

┌─ SimulationTabs ──────────────────────────────────────┐
│ [Path Sim] [Risk] [Return Dist] [Corp Val] [Correl]  │
└───────────────────────────────────────────────────────┘

┌─ ActiveWorkSection ───────────────────────────────────┐
│                                                       │
│  (Example: Path Simulation)                           │
│  ┌─ InputPanel ──────────┐ ┌─ ResultPanel ─────────┐ │
│  │ Initial: [___]        │ │ Status: [Running 43%] │ │
│  │ Return:  [━━━]        │ │                       │ │
│  │ Vol:     [━━━]        │ │ MetricGrid: median,   │ │
│  │ Horizon: [━━━]        │ │ p5, p95, max, min     │ │
│  │ Sims:    [___]        │ │                       │ │
│  │ Mode:    [▾]          │ │ [Paths Chart]         │ │
│  │ Seed:    [___]        │ │ [Percentile Cone]     │ │
│  │                       │ │                       │ │
│  │ [Run ▶] [Cancel ✕]   │ │ [Export CSV] [PNG]    │ │
│  └───────────────────────┘ └───────────────────────┘ │
│                                                       │
└───────────────────────────────────────────────────────┘
```

**Shared layout per sub-tab**: Input left/top → Status → Result metrics → Charts → Export
**Visual hierarchy**: experiment type → input state → run state → results → visuals
**Design rule**: Experimental but disciplined. Progress and cancellation very visible.

---

## 5. News Feed (Reader)

**Route**: `/news` | **Mode**: Clean reading stream

```
┌─ PageHeader ──────────────────────────────────────────┐
│ Market Intelligence                                   │
│ Articles ordered by date. Scroll for more.    [info]  │
└───────────────────────────────────────────────────────┘

┌─ ScrollFeed ──────────────────────────────────────────┐
│                                                       │
│  ┌─ NewsCard (today highlight: left accent border) ─┐ │
│  │ Samsung Reports Record Q4 Earnings        → ↗    │ │
│  │ 2024-12-20  [005930.KS]                          │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─ NewsCard ───────────────────────────────────────┐ │
│  │ Fed Signals Rate Pause in January         → ↗    │ │
│  │ 2024-12-19                                       │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─ NewsCard ───────────────────────────────────────┐ │
│  │ KOSPI Closes Above 2,600 Support          → ↗    │ │
│  │ 2024-12-19  [^KS11]                             │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  [Loading 5 more articles...]                         │
│                                                       │
└───────────────────────────────────────────────────────┘
```

**Visual hierarchy**: headline → date → ticker badge → source
**Design rule**: Quiet and readable. Typography quality over tool surface.

---

## 6. Modal Wireframes

### 6.1 Stock Detail Modal

```
┌─ ModalShell (size: xl) ──────────────────────────────┐
│ ✕  Samsung Electronics (005930.KS)                   │
│────────────────────────────────────────────────────── │
│ MetricGrid: Price │ Day Δ │ Sector │ Weight          │
│────────────────────────────────────────────────────── │
│ [OHLCV Chart — daily/monthly toggle]                 │
│────────────────────────────────────────────────────── │
│ Snapshot Context: version, source, benchmark         │
│────────────────────────────────────────────────────── │
│ Stock History Timeline                               │
│────────────────────────────────────────────────────── │
│ Ticker News Feed (filtered)                          │
└──────────────────────────────────────────────────────┘
```

### 6.2 Calculation Detail Modal

```
┌─ ModalShell (size: lg) ──────────────────────────────┐
│ ✕  ROIC - WACC Spread                               │
│────────────────────────────────────────────────────── │
│ Formula Explanation (markdown/text)                   │
│────────────────────────────────────────────────────── │
│ Result Summary: value, inputs used                   │
│────────────────────────────────────────────────────── │
│ Data Lineage: source → transform → output            │
│────────────────────────────────────────────────────── │
│ Supporting Rows (DenseTable)                         │
│────────────────────────────────────────────────────── │
│ Raw Datasets (collapsible)                           │
│────────────────────────────────────────────────────── │
│ [Download CSV: Analysis] [Download CSV: OHLCV]       │
│ [Download CSV: Statements]                           │
└──────────────────────────────────────────────────────┘
```

### 6.3 Snapshot History Modal

```
┌─ ModalShell (size: lg) ──────────────────────────────┐
│ ✕  Snapshot History                                  │
│────────────────────────────────────────────────────── │
│ Grouped by date:                                     │
│                                                       │
│ 2024-12-20                                           │
│   v3 — KOSPI200, ^KS11  [Review]                     │
│   v2 — KOSPI200, ^KS11  [Review]                     │
│                                                       │
│ 2024-12-15                                           │
│   v1 — Custom, ^KS11    [Review]                     │
│                                                       │
│ [Locked context: benchmark & universe read-only]     │
└──────────────────────────────────────────────────────┘
```
