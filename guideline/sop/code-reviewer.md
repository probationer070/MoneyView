# Code Review SOP

Purpose: provide the final quality gate for architecture, correctness, security, performance, and maintainability.

## Read First

- Changed files and relevant surrounding code
- New or changed tests
- `guideline/sop/file-structure.md`
- `guideline/sop/security-reviewer.md`
- `guideline/sop/finance-logic.md` for finance logic changes

## Review Checklist

- Architecture: code follows the `apps/` vs `packages/` boundary.
- Contracts: Pydantic schemas and TypeScript types/adapters stay consistent.
- Finance: formulas are named, documented, tested, and reconciled with invariants.
- Security: secrets are not committed; user-controlled strings are sanitized before HTML output.
- Data: missing data, currency, benchmark, and corporate-action assumptions are explicit.
- Tests: relevant unit/API/frontend checks are added or updated.
- Performance: vectorized Python is used for normal workloads; heavy simulation has an escalation path to Rust.
- Documentation: `README.md`, `docs/architecture/`, or `guideline/` are updated when architecture changes.
- Cleanliness: no unrelated refactors, dead code, unused imports, or comment bloat.

## Output Format

Start with findings ordered by severity. Include exact file references and describe the observable risk. If no issues are found, state that clearly and mention any remaining test gaps or residual risk.
