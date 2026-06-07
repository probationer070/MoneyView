<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# MoneyView Web Rules

Apply the repo-root `AGENTS.md` first, then these web-specific rules.

## Read Before Editing

- `guideline/sop/file-structure.md`
- `guideline/sop/architect.md`
- `guideline/sop/build-error-resolver.md`
- relevant notes under `docs/architecture/`

## Ownership

- `apps/web` owns UI state, rendering, chart adapters, mutation controls, and query invalidation/refetch behavior.
- Do not place core financial formulas in the frontend.
- Keep API contract assumptions aligned with backend schemas and `packages/shared-types` when those contracts are mirrored in TypeScript.

## Implementation Rules

- For endpoint-triggered UI actions, define which React Query keys must refresh immediately after success.
- Keep page-level query ownership in route pages or clear container components, not inside presentational chart components.
- Follow existing visual and structural patterns unless the task explicitly asks for a redesign.

## Verification

- Prefer narrow frontend verification first, such as `npm.cmd run lint -- <path>`.
- If PowerShell blocks `npm`, use `npm.cmd`.
