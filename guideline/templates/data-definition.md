# Data Definition: <table or payload name>

Standalone template for one table or API payload. Use it at stage 1 of
[`../HARNESS.md`](../HARNESS.md); work card §4 is the short form for single fields.
For tables that already exist, read
[`docs/architecture/database-relationships.md`](../../docs/architecture/database-relationships.md)
first and link to it instead of restating it.

- Kind: <SQLite table | API response | peer-sync file | cache file>
- Defined in: <file:line>
- Existing or new: <existing | new>

## Fields

<!-- Unit: write "fraction" or "percent" explicitly. Nullable: also say what the UI
shows when the value is missing. -->

| field | type | unit | nullable | example | meaning |
|---|---|---|---|---|---|
| `upside_pct` | float | percent (5.0 = 5 %) | no (0.0 when price is not positive) | `12.35` | comparable value against current price |

## Keys and uniqueness

| Item | Definition |
|---|---|
| Primary key | <columns> |
| Unique constraints | <columns, or none> |
| References | <table.column, declared or logical> |

## Lifecycle

| Event | Who / when |
|---|---|
| Written by | <module and trigger> |
| Updated when | <trigger, or never> |
| Deleted when | <trigger or retention rule, or never> |

## Sync and rebuild class

| Question | Answer |
|---|---|
| Synced between PCs? | <yes: how and which kind / no> |
| Rebuildable? | <yes: from what, by which command / no: owner's own record> |
| Class | <derived cache / fetched data / owner record> |

## Consumers

| Consumer | Reads | Notes |
|---|---|---|
| `apps/web/app/corporate/...` | `upside_pct` | shown through DeltaBadge |
