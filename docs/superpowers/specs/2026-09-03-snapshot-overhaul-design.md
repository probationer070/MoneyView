# Snapshot Overhaul — Decisions, Dedupe and Outcomes — Design

Date: 2026-09-03
Status: draft, pending review
Source: session brainstorm, 2026-09-03. Motivating complaint: snapshots carry no
memo and no visualization, so their utility is worse than a commercial service.
Scope: a durable **decision** record, snapshot **dedupe on write**, and one
**outcome visualization**. The snapshot subsystem is rebuilt, not removed.

> Every figure quoted below was measured against `data/processed/moneyview.db`
> on 2026-09-03, not assumed. The measurements are reproduced inline so a
> reviewer can disagree with the evidence rather than only with the conclusion.

---

## 1. Problem

A snapshot today is a frozen row per ticker — `roic`, `wacc`, `dcf_value`,
`current_price`, expected returns — keyed by `(snapshot_version, ticker)` in
`corporate_comparison_snapshots_v3`, with universe and assumption metadata
beside it. It is written by `save_corporate_comparison_snapshot`
(`apps/api/services/corporate_comparison.py`) and read back by a history modal
(`apps/web/app/portfolio/components/SnapshotHistoryModal.tsx`).

| Problem | Measured evidence | Change |
| --- | --- | --- |
| Nothing records **why** a snapshot mattered | no annotation column exists anywhere in the schema | §3 Decisions |
| Refresh noise | **8 versions** on `2026-04-23`, seven of them within ~3 minutes | §5 Dedupe |
| No way to evaluate a prediction | the history modal is a list; no chart exists | §6 Visualization |
| Snapshots read as a permanent record | `SNAPSHOT_RETENTION_DAYS = 365` — they are already pruned | §3, §7 |

### 1.1 The snapshots are not a durable record, and the code already says so

`corporate_comparison.py:34` sets `SNAPSHOT_RETENTION_DAYS = 365`. Snapshots
expire. Anything a user hoped to keep long-term was going to be deleted at the
one-year mark regardless. Building the durable record as a **separate entity**
is therefore not a new opinion imposed by this design; it makes explicit a
policy that is already in the code.

A second observation, from the same table: the newest snapshot is dated
`2026-07-28`, five weeks before this design. `snapshot_source` values of
`scheduled_kst_daily` are a **label applied when the comparison endpoint is
hit**, not evidence of a background job. No daemon exists. Clearing the table
will not silently refill it.

### 1.2 What "refresh noise" actually is

The stated complaint was "seven near-identical versions in three minutes". The
data is more specific, and the difference changes the fix:

| ticker | across all 8 versions of 2026-04-23 |
| --- | --- |
| `MSFT` | byte-identical |
| `IAUM` | byte-identical |
| `^GSPC` | `dcf_value` 6313.41 → 6313.14 → 6313.34 → 6312.65 → 6312.59 |

Only the **benchmark index ticks between clicks**. A dedupe rule phrased as
"suppress a write whose substantive model figures match the previous version"
would therefore catch **3 of 8** and let the rest through, defeated by pennies
of movement on a ticker nobody was looking at. §5 specifies a rule that is not
defeated this way.

### 1.3 `dcf_implied_return` has no time horizon

```python
# packages/core_finance/expected_return.py:54
def calculate_dcf_implied_return(current_price: float, intrinsic_value: float) -> float:
    if current_price <= 0:
        return 0.0
    return float((intrinsic_value / current_price) - 1.0)
```

Verified against stored data: MSFT `dcf_value` 379.39, `current_price` 431.65,
`dcf_implied_return` −12.11.

This is **total upside to fair value**, not an annualized expectation. Any
realized return, by contrast, is measured over a stated period. Charting the
two as "predicted vs realized" would place a horizonless quantity beside a
horizoned one on a single axis — the defect class `ERROR-LOG.md` records twice
already ("enterprise values presented as intrinsic values per share",
2026-08-05; the `252d`-label-on-a-502-day-window case, 2026-08-30). §6 refuses
that framing.

Note this conflation is **already live**: `capm_expected_return` is
`risk_free_rate + beta × ERP`, an annual figure, while `stock_expected_return`
is the horizonless DCF upside (`STOCK_EXPECTED_RETURN_METHOD =
"dcf_implied_upside"`, `corporate_comparison.py:36`), and
`expected_return_spread` subtracts one from the other. Fixing that is **out of
scope** (§9); this design only declines to build a second instance of it.

---

## 2. Decomposition

Three independent pieces, in this order:

1. **Decisions** (§3, §4) — the durable record. No dependency on the others.
2. **Dedupe on write** (§5) — snapshot hygiene. Independent of decisions.
3. **Outcome visualization** (§6) — depends on decisions existing.

The data reset (§7) is a one-off that precedes 2.

---

## 3. Data model

New table `investment_decision`, one row per ticker per decision:

| group | columns |
| --- | --- |
| identity | `id` INTEGER PK, `ticker` TEXT NOT NULL, `decided_at` TEXT NOT NULL (ISO-8601 UTC) |
| judgement | `action` TEXT NOT NULL (`buy`/`sell`/`watch`/`pass`), `memo` TEXT NOT NULL |
| copied figures | `price_at_decision`, `dcf_value`, `dcf_implied_return`, `roic`, `wacc`, `risk_free_rate`, `equity_risk_premium` REAL; `metric_schema_version` INTEGER |
| attribution | `figures_source` TEXT NOT NULL, `figures_unavailable_reason` TEXT |

### 3.1 Figures are copied, not referenced

The decision stores the numbers rather than a foreign key to a snapshot row.

Snapshots expire at 365 days (§1.1) and are about to be cleared wholesale (§7),
so a reference would dangle by design. Worse, metric definitions change:
`SnapshotHistoryModal` already warns *"Metric definition changed. Values before
and after this point are not directly comparable."* A decision that references
a snapshot is silently reinterpreted when the schema moves; one that copies the
numbers is a fixed record of what was actually believed at that moment.

### 3.2 `memo` is NOT NULL

A decision without a stated reason is a snapshot, and snapshots already exist.
The column is required so the feature cannot decay back into what it replaced.

### 3.3 `figures_unavailable_reason` — a decision is recordable without figures

If the model cannot value the ticker at record time, the decision is still
written, with the reason in place of the numbers. This mirrors
`valuation_verdict.py`'s per-signal refusal: a refusal is content, not an error.

Without it, the feature would refuse to record decisions about exactly the
companies the model finds hardest to value — which are the ones a memo is most
worth having. Exactly one of `figures_unavailable_reason` and the copied
figures is populated.

### 3.4 No retention policy

Deliberate, and the point of the whole design. Snapshots expire; decisions do
not. A comment on the table states this so the asymmetry is not read as an
oversight.

---

## 4. Recording a decision

`POST /api/v1/decisions` accepts `{ticker, action, memo}` and **nothing else**.
The server computes the figures at record time through `_dcf_snapshot`
(`apps/api/services/corporate_comparison.py:352` at `renewal` a50f255) -- the
same function that produces the comparison table's figures -- and writes them
itself.

The client never sends numbers. A browser-posted figure could be stale, rounded
for display, or read from a page opened an hour earlier — and it would be
stored as what the user believed, with no way to detect the difference later.
Server-side capture makes the record self-certifying, and `figures_source`
names the path the copy came from.

`GET /api/v1/decisions` lists decisions, newest first, each with its outcome
block (§4.1). `GET /api/v1/decisions/{id}` returns one.

Editing is out of scope (§9): a decision is a record of what was believed at a
time, and an editable record of a past belief is not evidence of anything.

### 4.1 Outcomes are computed on read, never stored

Each returned decision carries an outcome block derived from `stocks`: the
latest close, its date, and the move from `price_at_decision` — **with both
dates named**, so the period is stated rather than implied.

Not stored, because a stored outcome is correct only until the next bar arrives
and then silently wrong, with nothing to reveal it. Computing on read cannot go
stale.

If no bar exists after `decided_at`, the outcome refuses with a reason rather
than reporting `0.0%`. A flat number would be indistinguishable from a genuine
zero move.

---

## 5. Dedupe on write

**Rule:** a snapshot write replaces in place when
`(snapshot_date, universe_key, risk_free_rate, equity_risk_premium,
metric_schema_version)` matches an existing version. A changed **assumption,
universe or day** creates a new version; a repeated click on the same day with
the same assumptions does not.

This is deliberately **not** a comparison of output figures. §1.2 shows why:
output comparison is defeated by a benchmark ticking between clicks, and would
have suppressed only 3 of the 8 observed duplicates. Keying on inputs needs no
float tolerance and cannot be defeated that way.

### 5.1 Consequence: `snapshot_version` loses its timestamp

Replace-in-place requires a deterministic key, so `snapshot_version` changes
from

```
2026-04-23|portfolio_plus_benchmark|^GSPC||2026-04-22T17:31:11.095576+00:00
```

to a form carrying the assumptions and no timestamp:

```
2026-04-23|portfolio_plus_benchmark|^GSPC||rf=4.2|erp=5.5|schema=2
```

This is a change to how the key is **composed**, not to the schema. The three
snapshot endpoints (`POST /comparison/snapshot`, `GET`/`DELETE
/comparison/snapshot-version`) treat `snapshot_version` as an opaque string and
are unaffected. Because every row is cleared first (§7), there is no migration.

Recorded here because the brainstorm initially deferred "snapshot identity" as
cosmetic; this is a narrower, load-bearing part of it that the dedupe rule
requires. The *readable*-identity work remains out of scope (§9).

---

## 6. Visualization

**Per decision**, two figures side by side, each labelled with its own basis:

- *gap to fair value at decision* — `dcf_implied_return`, no horizon
- *price move, `decided_at` → `latest_bar_date`* — a stated period

**One chart:** a scatter, gap-at-decision on x, price-move-since on y, one
point per decision.

Explicitly **no trend line, no R², no accuracy score, no error metric**. Each
of those asserts that the two axes are commensurable, and §1.3 shows they are
not. The scatter displays whatever relationship exists without claiming one.

A genuine accuracy measure would require an explicit convergence assumption
("price reaches fair value within N years") stated as an assumption of the
chart. That is out of scope (§9).

The `dataviz` skill is to be loaded before any chart code is written.

---

## 7. Data reset

Clear **all three** snapshot tables as a one-off, after a database backup:

| table | rows on 2026-09-03 |
| --- | --- |
| `corporate_comparison_snapshots` | 139 |
| `corporate_comparison_snapshots_v2` | 0 |
| `corporate_comparison_snapshots_v3` | 880 |

Naming all three matters: clearing only `_v3` would leave 139 v1 rows behind
and the "clean start" would be false.

The reset precedes the dedupe change so the new rule starts against an empty
table and no row survives under the old key composition.

This is irreversible. The rows are point-in-time records that cannot be
regenerated. It is done at the user's explicit instruction, given after that
consequence was stated.

---

## 8. Verification

Per `guideline/sop/test-verification.md`, no test is trusted on the strength of
a passing run. Each of the following is mutation-verified and the mutation
recorded:

| Guarantee | Mutation that must break it |
| --- | --- |
| A decision preserves memo, action and figures independently of snapshots | delete all snapshots after recording; the decision must still return its figures |
| Repeated write, unchanged assumptions → no new version | make the key include a timestamp again; the duplicate-count assertion must fail |
| Changed assumption → new version | make the key ignore `risk_free_rate`; the new-version assertion must fail |
| Figures are captured server-side | post client-supplied figures; they must be ignored |
| A decision with unavailable figures is still recorded | make the recorder raise instead of storing the reason |
| Outcome names its period | drop the dates from the outcome block |

Outcome arithmetic is pure over bars and unit-tests exactly. Route tests cover
the API. One Playwright e2e covers the page, following the 16 specs already in
`apps/web/tests/e2e/`.

The dedupe tests must assert against the **2026-04-23 shape specifically** — a
fixture where one ticker's figures move and two do not — because a fixture
where everything is identical would pass under the rejected output-comparison
rule too, and prove nothing about the rule actually chosen.

---

## 9. Out of scope

| Item | Why |
| --- | --- |
| Readable snapshot identity | cosmetic; ripples through the PK, three endpoints and the history modal. §5.1 changes key *composition* only |
| Charts over snapshot history | the table is being emptied; it would be built and validated against nothing |
| Metric-schema comparability | definitions legitimately change; the existing warning is the honest disclosure |
| The pre-existing annual-vs-horizonless conflation in `expected_return_spread` | real (§1.3) but predates this work and touches `/corporate` |
| Multi-ticker decisions | an outcome for a set needs weights; one ticker per decision, recorded several times |
| Editing a decision | an editable record of a past belief is not evidence |
| Removing the snapshot subsystem | the comparison workspace uses it; only its record-keeping role is superseded |

---

## 10. Decisions taken during design

| Question | Resolution |
| --- | --- |
| What job does a snapshot do? | decision record **with outcomes**, over research journal or comparison workspace |
| Memo on a snapshot row, or its own entity? | own entity — snapshots are noisy, expiring and about to be deleted |
| Do snapshots survive? | yes; the system is rebuilt, not removed |
| Predicted-vs-realized accuracy? | **no** — §1.3; two labelled series instead |
| Dedupe on outputs or inputs? | **inputs** — §1.2; output comparison catches 3 of 8 |
| Who captures the figures? | the server, at record time — §4 |
