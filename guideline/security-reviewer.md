# Security Review SOP

Purpose: keep MoneyView secure by default, especially around secrets, local data, generated reports, and financial integrity.

## Read First

- Changed files
- `.gitignore`
- `config/.env.example`
- Any code that reads local files, executes commands, builds SQL, or renders HTML

## Security Gate

- Secrets: no real API keys, tokens, DB credentials, or private endpoints committed.
- Config: commit templates only; keep local `.env` files ignored.
- SQL: use parameterized queries for user-provided values.
- HTML/reporting: escape user-controlled content before injecting into generated HTML.
- File paths: avoid absolute paths; validate destructive file operations.
- API: validate all request payloads with Pydantic models.
- Logging: do not log secrets or full sensitive payloads.
- Dependencies: run audits when dependency files change.

## Financial Integrity

- Define tolerances for floating-point invariants.
- Use `Decimal` or fixed-point only where money rounding is legally/accountingly material.
- For analytics returns and risk metrics, floats are acceptable when tolerances and rounding policy are explicit.
- Tests must cover reconciliation invariants and missing-data behavior.

## Required Checks

Use targeted scans such as:

```powershell
rg -n "API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY" .
```

When dependency files change:

```powershell
pip audit
npm audit
```

If audit tools are unavailable, state that clearly in the final response.
