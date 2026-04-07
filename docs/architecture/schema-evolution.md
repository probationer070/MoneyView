# Schema Evolution Rules

Backend Pydantic models are the source of truth.

All schema changes must:

1. Update the Pydantic model in `apps/api/models/schemas.py`.
2. Re-export the model from `apps/api/schemas/portfolio.py` when it is part of the portfolio/report public contract.
3. Run `python scripts/export_schema.py`.
4. Regenerate TypeScript types in `packages/shared-types/generated/`.
5. Validate API compatibility through tests.

## CI Check

Recommended check:

```powershell
python scripts/export_schema.py
npx json2ts packages/shared-types/generated/portfolio.schema.json > packages/shared-types/generated/portfolio.ts
git diff --exit-code packages/shared-types
```

If `json2ts` is unavailable, update the generated TypeScript file with the same Pydantic schema changes and document that limitation in the final change note.

## Compatibility Rules

- Additive response fields are allowed when optional or defaulted.
- Removing fields requires a schema version bump.
- Renaming fields requires a migration note and frontend adapter update.
- Enum changes require tests for accepted and rejected values.
