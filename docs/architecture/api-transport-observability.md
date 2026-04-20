# API Transport Observability

The API now exposes transport-progress visibility in both the live server console and the persistent JSON log file.

The local web app also avoids using a client-triggered Server Action for backend-port discovery during normal boot. Client-side runtime discovery now goes through `GET /api/runtime/backend-port` on the Next.js app server, which removes the repetitive `discoverBackendPort()` action trace from the Next dev log.

## What Is Logged

Known-size responses:
- middleware emits `transport.progress`
- fields include:
  - `request_id`
  - `method`
  - `path`
  - `status_code`
  - `bytes_sent`
  - `total_bytes`
  - `progress_pct`
  - `chunk_count`
  - `elapsed_ms`
  - `completed`
  - `transport_kind=known_size`

Streaming / SSE responses:
- middleware emits `transport.progress` with `transport_kind=sse`
- route-level phase logging emits `transport.phase`
- DCF SSE currently logs:
  - `phase1`
  - `phase2`
  - `complete`

## Ownership

- `apps/api/core/logger.py`
  - shared console and file handler configuration
  - structured JSON fields for transport progress
- `apps/api/core/transport_progress.py`
  - middleware for known-size and streaming transport progress
  - route helper for explicit phase logs
- `apps/api/routes/corporate.py`
  - emits DCF SSE phase progress

## Truthfulness Rules

- Percentages are logged only when `total_bytes` is known.
- SSE routes do not fabricate percentages just to appear complete.
- For phased streaming, explicit phase logs are considered the authoritative progress signal.

## Current Instrumented Paths

- `GET /api/v1/stock/{ticker}/price`
  - known-size transport progress
- `POST /api/v1/corporate/dcf/{ticker}/stream`
  - SSE transport progress plus `phase1` / `phase2` / `complete`
- `GET /api/v1/diagnostic/logs/api-tail`
  - plain-text tail of the persistent `api-server.log` file for local debugging when the realtime API console is not visible

## Local Fallback Workflow

- Persistent API logs are written to `data/cache/logs/api-server.log` unless `API_LOG_PATH` overrides the location.
- The diagnostic endpoint `GET /api/v1/diagnostic/logs/api-tail?lines=100` returns the most recent plain-text log lines from that file.
- This endpoint is intended as a local developer fallback for visibility, not as a user-facing production feature.
