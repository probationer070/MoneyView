# Decisions log: edit and delete a mistaken entry

Date: 2026-11-01 · Owner: probationer070 · Path: full (schema column, synced kind, new endpoints)

## 1. Intent

A decision recorded with the wrong action or a typo in the memo can't be fixed today. A decision
recorded against the wrong ticker can't be removed. The log is only useful if its entries are right.

The page's promise still holds: the **figures** (price, DCF value, ROIC, WACC, risk-free rate, ERP,
schema version, figures source / unavailable reason, `decided_at`) are captured by the server at
record time and never change. What the owner typed can be corrected, and a correction is visible.

## 2. Decisions (owner, 2026-11-01)

| Decision | Choice |
|---|---|
| Editable fields | `action` and `memo` only. Ticker is fixed: the captured figures belong to it. A wrong ticker is fixed by delete + re-record. |
| Edit trace | Shown: "수정됨 · <local time>" on the entry. Stored as a new nullable column `edited_at` (ISO-8601 UTC). |
| Delete | Allowed, permanent, synced to the other PC. |

My calls:

| Call | Choice | Why |
|---|---|---|
| Delete confirmation | Inline two-step (Delete → "삭제할까요? 확인 / 취소" in the card), no browser `confirm()` | browser dialogs are banned in this app's tests and block automation |
| Edit UI | The card switches in place to an action `<select>` + memo `<textarea>` + 저장/취소 | same controls as the record form |
| Edit history | Only the last edit time; no previous-text history | the owner asked for a mark, not an audit log |
| Empty memo on edit | Refused (422), same rule as record | a decision without a reason is a snapshot |
| No-op edit (same action and memo) | 200, `edited_at` unchanged | an unchanged save is not an edit |

## 3. Backend

- `db.py`: `ALTER TABLE investment_decision ADD COLUMN edited_at TEXT` in the same guarded block the other
  added columns use (`PRAGMA table_info`). Nullable: existing rows were never edited.
- `records_sync/kinds.py` `KIND_DECISION`: `edited_at` in `columns` and in `optional_columns`, so a peer
  file from a PC that has not updated yet reads as NULL (the `offering_price` precedent).
- `services/investment_decision.py`:
  - `update_decision(decision_id: int, *, action: str, memo: str) -> dict | None` — validates like
    `record_decision`, writes `action`, `memo`, `edited_at = now UTC` (only if something changed), and
    `records_sync_store.stamp(...)` the row's `sync_uid`. Returns the row as `get_decision` does; `None` if missing.
  - `delete_decision(decision_id: int) -> bool` — `record_removal(...)` then `DELETE`, in one transaction
    (the `events/service.py` delete is the pattern). `False` if missing.
- `routes/decisions.py`:
  - `PATCH /api/v1/decisions/{id}` body `DecisionEdit {action, memo}` with `extra="forbid"`: a figure or a
    ticker in the body is a 422. 404 if missing. Then `run_records_sync("mutation")`.
  - `DELETE /api/v1/decisions/{id}` → 204; 404 if missing. Then `run_records_sync("mutation")`.
- `DecisionRow` gains `edited_at: str | None = None`.

## 4. Frontend (`app/decisions`)

- `DecisionList` card: two `IconButton`s (lucide `Pencil`, `Trash2`) with `aria-label` 수정 / 삭제.
- Edit mode as in §2; save calls PATCH, invalidates `["decisions"]`; an error shows inline (`role="alert"`).
- Delete: inline confirm; DELETE; invalidate. The card disappears; the scatter chart drops its point.
- `edited_at` set → `type-small text-[var(--ink-muted)]` "수정됨 · <time>" beside `decided_at`.
- New strings go through `t("decisions.*")` (ko formal register + en). The page's existing hard-coded
  English strings are out of scope and stay as they are (noted for a later i18n pass).

## 5. Output contract

| name | returns | cases | side effects |
|---|---|---|---|
| `PATCH /decisions/{id}` | 200 `APIResponse[DecisionRow]` | ok: row with new action/memo and `edited_at`; same values: row, `edited_at` unchanged; missing id: 404; bad action / blank memo / extra field: 422 | row update, sync stamp, records sync |
| `DELETE /decisions/{id}` | 204 | missing id: 404 | row delete, tombstone, records sync |
| `update_decision` | `dict \| None` | as above; `ValueError` on invalid input | as above |
| `delete_decision` | `bool` | missing → `False` | as above |

Example: PATCH `{action:"sell", memo:"thesis broke"}` on id 3 (was buy) → `action:"sell"`,
`edited_at:"2026-11-01T05:12:00Z"`, `price_at_decision` unchanged.

## 6. Tests

New pytest (`tests/api/`): edit changes action+memo and sets `edited_at`; edit leaves every figure column and
`decided_at` byte-identical; body with `price_at_decision` or `ticker` → 422; blank memo → 422; no-op edit keeps
`edited_at` NULL; delete removes the row and writes a tombstone; a peer file without `edited_at` merges as NULL;
a peer's tombstone removes the row on the other PC (records-sync round trip, existing harness).

New Playwright (`decisions.spec.ts`, new blocks): edit flow shows "수정됨"; cancel restores; delete needs the
second click; error from the mock shows the alert.

Mutations: `update_decision` also writes `price_at_decision` → figures-unchanged test fails; drop
`record_removal` → tombstone test fails; drop the no-op check → no-op test fails; omit `edited_at` from
`optional_columns` → old-peer merge test fails.

Existing-test change inventory: expected **none**. If a records-sync test pins the decision kind's column
list, it becomes row 1 and comes back to the owner before it is edited.

Run: decision and records-sync pytest files, `decisions.spec.ts`, `records-sync-status.spec.ts`, then the full
suite (`db.py` and `records_sync/**` are shared surfaces).

## 7. Docs

`docs/architecture/database-relationships.md` (§2.6 row: `edited_at`), `docs/architecture/storage-model.md` if it
lists columns, `docs/USER-GUIDE.md` (how to correct a decision), the Decisions subtitle in ko/en: "수치는 기록 시점에
서버가 캡처하며 수정되지 않습니다. 행동과 메모는 고칠 수 있고, 고친 기록에는 수정 시각이 표시됩니다."

## Approval

Approved by the owner on 2026-11-02 ("1~3번 승인"), including the existing-test changes this spec lists.
