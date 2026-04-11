# Corporate Search And Portfolio Bootstrap Todo

Purpose: stop browser-style previous search suggestions in Corporate Analysis and restore Portfolio bootstrap when `stock_targets.json` is missing by regenerating it from persisted database records.

## Current State

- [x] Confirm the Corporate Analysis company search input path.
- [x] Confirm whether search history is app-managed or browser-managed.
- [x] Confirm the current watchlist/bootstrap path for missing `stock_targets.json`.
- [x] Confirm what persisted company data exists in the local SQLite database.

Notes:
- The `Company Search` dropdown is driven by the current company registry, not by app-level saved search history.
- Previous search query suggestions are coming from browser autocomplete on the input field.
- `apps/api/services/webscrap/stock_targets.json` is currently missing.
- The local DB currently has persisted `corporate_metrics` tickers even when `watchlist` is empty.

## Frontend

- [x] Disable browser autocomplete/history suggestions for the Corporate Analysis `Company Search` input.
- [x] Keep normal live filtering against the company registry intact.
- [x] Avoid changing assumption persistence behavior unrelated to company search history.

## Backend

- [x] Keep the SQLite database as the primary source of truth for watchlist/company recovery.
- [x] When `stock_targets.json` is missing, attempt to rebuild it from DB-backed sources before using built-in defaults.
- [x] Include `watchlist`, `corporate_companies`, and `corporate_metrics` as DB sources for regeneration.
- [x] Preserve the existing one-time bootstrap behavior for watchlist seeding.
- [x] Avoid overwriting an existing `stock_targets.json` file unnecessarily.

## Persistence

- [x] Regenerate `apps/api/services/webscrap/stock_targets.json` from DB rows when possible.
- [x] Preserve group/name/sector/weight data where it already exists in the DB.
- [x] Fall back to built-in defaults only when no DB-backed company records are available.

## Verification

- [x] Corporate `Company Search` input no longer advertises prior typed queries via browser autocomplete attributes.
- [x] Missing `stock_targets.json` can be regenerated from DB-backed company records.
- [x] Regenerated JSON is written under `apps/api/services/webscrap/stock_targets.json`.
- [x] Portfolio local DB state is restored if the current workspace is still stuck in an empty user-mutation state.

## Risks To Watch

- [x] Do not break live company filtering while disabling browser history suggestions.
- [x] Do not overwrite intentional user-managed watchlist state just because the JSON seed file is rebuilt.
- [x] Do not rely only on `corporate_companies`; persisted `corporate_metrics` tickers must also participate in regeneration.
