# Work Card: <short title>

Copy this file for each task. Fill §1 at intake, §2-5 at design (owner approves,
including the §5 output contract), §6 at plan time, §7-8 before implementing, §9 as you go. Delete the guidance
comments when done. Procedure: [`../HARNESS.md`](../HARNESS.md).

- Date: <YYYY-MM-DD>
- Path: <light | full>
- Branch: <name>

## 1. Purpose & success criteria

<!-- Who uses it, what decision it supports, a measurable "done". No "works well". -->

- Who uses it: the owner, reading the Corporate tab
- Decision it supports: whether a ticker is under- or overvalued
- Done when: <measurable check, e.g. "the verdict strip shows the same upside as the DCF table for every fixture ticker">

## 2. Scope / Out of scope

<!-- Out of scope lists things someone might expect but you will not do. -->

| In scope | Out of scope |
|---|---|
| Show upside in the verdict strip | Peer universe changes (separate spec) |

## 3. Design summary

<!-- Diagram if it helps. One row per key decision, with the owner's answer and date. -->

| Decision | Choice | Owner answer |
|---|---|---|
| Upside stays in percent units end to end | yes | approved 2026-10-14 |

## 4. Data definition

<!-- One row per field the task reads, writes or shows. Unit: write "fraction" or
"percent", never "ratio". Missing display: what the user sees for null.
Existing tables: ../../docs/architecture/database-relationships.md.
A whole table or payload: use data-definition.md instead. -->

| field | type | unit | source / provider | nullable / missing display | example | owning table | written by | synced between PCs? | rebuildable? |
|---|---|---|---|---|---|---|---|---|---|
| `upside_pct` | float | percent (5.0 = 5 %) | computed in `apps/api/services/corporate_dcf.py` | never null; 0.0 when price is not positive; DeltaBadge shows the sign | `12.35` | none (API payload only) | `corporate_dcf.py`, per request | no | yes, recomputed |

## 5. Interfaces

<!-- Exact signatures: functions, endpoints, components. A reviewer should be able to
call them from this table alone. -->

| Kind | Name | Signature | Notes |
|---|---|---|---|
| payload field | `upside_pct` | `((comparable_value - current_price) / current_price) * 100` | percent, rounded to 2 places |

### Output contract

<!-- Mandatory for EVERY function, method, endpoint and component the task adds or
changes (HARNESS.md "Plan rule"). A plan task without a row here is rejected in
plan review. "cases" must cover normal, empty, missing/null, error and refused,
or say "n/a: <why>". Example is one concrete input -> output. -->

| name | signature | returns (type/shape) | units/format | cases (normal / empty / missing / error) | example | side effects |
|---|---|---|---|---|---|---|
| `verdictLabelKey` (`apps/web/app/corporate/verdict.ts`) | `(status: string): LabelKey \| null` | `LabelKey` or `null` | label key, not display text | normal: `"Undervalued"` gives `"undervalued"`; empty `""`, unknown, or `"constructor"` gives `null` (shown as sent); missing: n/a, input is a string; error: never throws; refused: n/a | `"Bridge Incomplete"` -> `"bridgeIncomplete"` | none |
| `formatNumber` (`apps/web/lib/format.ts`) | `(value: number \| null \| undefined, kind: NumberKind, opts?: { digits?: number; signed?: boolean; locale?: "en" \| "ko" }): string` | `string` | `percent` takes a FRACTION: 0.123 gives `12.3%`; ASCII `-`; `signed` adds `+` except at zero | normal: formatted figure; empty: n/a; missing: `null`, `undefined`, `NaN`, `Infinity` give `—`; error: never throws | `formatNumber(0.143, "percent", { signed: true })` -> `+14.3%` | none |

## 6. Test plan

### New tests

| Test | File | Proves |
|---|---|---|
| `upside is percent, not fraction` | `tests/api/test_corporate_dcf.py` | price 100, value 112 gives `12.0` |

### Existing-test change inventory

<!-- Only assertions that already exist and must change. Locate rows by the quoted
code, not the line number alone. If none, write "none". -->

| # | File:line | Old | New | Why |
|---|---|---|---|---|
| 1 | `tests/e2e/example.spec.ts:42` | `toHaveText("Upside")` | `toHaveText("Upside (%)")` | label gains its unit |

**Approved by the owner on <YYYY-MM-DD>** (rows as listed; changes: <none | list>).

### Mutation matrix

<!-- Procedure: ../sop/test-verification.md. One mutation at a time; the named test
must FAIL for the named reason. Restore, then confirm no diff. -->

| Mutation (one at a time) | Test that must fail |
|---|---|
| `* 100` removed from `upside_pct` | `upside is percent, not fraction` |

## 7. Risks & money-impact checks

<!-- Fill each row, or write "n/a: <why>". -->

| Check | Result |
|---|---|
| Scale: fraction vs percent at every boundary | e.g. DeltaBadge receives percent, divides nothing |
| Sign: negative and zero render with the right sign and colour | |
| Stale or debounced value: the UI never shows an input older than the one computed | |
| Ticker scoping: a ticker switch never shows the previous ticker's value | |
| Shown value = used value | |
| Missing data: null shows the stated fallback, not 0 | |

## 8. Model routing for this card

<!-- Defaults are in ../HARNESS.md. Change a row only with a reason. -->

| Stage | Model | Note |
|---|---|---|
| Design | <Opus if complex, else Sonnet> | |
| Plan | Sonnet | Opus if architectural |
| Implement | Haiku | |
| Task review | Sonnet | |
| Final review | Opus | |

## 9. Decisions & approvals log

| Date | Decision or approval | By |
|---|---|---|
| 2026-10-14 | Test-change inventory approved, 57 rows unchanged (example) | owner |
