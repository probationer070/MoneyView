# Compute Split — Slice 1 Results

**Date:** 2026-07-25
**Host:** DESKTOP-CGQOHT6 (native Windows, Python 3.12.7)
**Endpoint:** POST /api/v1/portfolio/attribution
**Serializer:** shared sentinel serializer — `dumps_model` / `loads_model`, single policy on both ends (spec §A-3)

## Added-hop latency (loopback ASGI transport, N=100)

Measured by `scripts/benchmark_compute_hop.py 100`. HTTP mode uses `httpx.ASGITransport`
against `compute_app` — the closest in-test analogue to the two-process split (no real
socket). It isolates serialization + client/server request handling; a real loopback
socket adds a small, roughly constant kernel round-trip on top.

| Mode | p50 | p95 |
|------|-----|-----|
| inprocess | 0.17 ms | 0.29 ms |
| http (loopback transport) | 0.90 ms | 1.16 ms |
| **added hop** | **0.73 ms** | **0.87 ms** |

**Threshold:** added-hop p95 < 15 ms on loopback → **PASS** (0.87 ms, ~17× margin).

## Three-bucket attribution (§A-2, http mode, one representative call)

Captured from the `compute_client.build_attribution` `PerformanceEvent` (scope=`external`).

| Bucket | Value | Source |
|--------|-------|--------|
| serialization_ms | 0.188 | MEASURED (encode request + decode response) |
| compute_ms | 24.3 | MEASURED, server-side (`X-Compute-Duration-Ms` header) |
| wire_estimated_ms | 20.02 | MODELED (20 ms assumed RTT + payload/125000 B·ms⁻¹), NOT loopback residual |
| payload_bytes | 2518 | measured response length |

`wire_note`: "loopback measured / Tailscale estimated". Compute dominates end-to-end
cost; serialization is negligible (<0.2 ms). The modeled wire figure is what a real
Tailscale hop would add — deliberately not the ~sub-millisecond loopback residual, so
the number stays honest for the two-process/remote target.

## Fidelity (spec §A-3, Task 2 — 5/5 tests green)
- NaN / +Inf / −Inf round-trip via shared sentinel: PASS
- naive + timezone-aware datetime round-trip: PASS
- enum-by-value round-trip: PASS
- Decimal-absence guard on AttributionRequest / AttributionResult (transitive through nested generics): PASS

## Parity (Task 5/6)
- inprocess vs http `AttributionResult` (excluding generated-at / cache-key / cache-hit variable fields): identical
- route `/attribution` dispatches through the injected `ComputeClient` seam (spy-client 418 tripwire, proven red-under-revert)

## WSL networking mode
- `wslinfo --networking-mode` → **nat**. Loopback is a real isolation boundary.
- This benchmark ran on **native Windows** Python (not inside WSL), where `127.0.0.1`
  is already a kernel-level OS boundary regardless of WSL mode — loopback-as-boundary is **valid**.

## Go / no-go
- **PASS** — the coarse `/attribution` boundary round-trips with full fidelity and
  negligible added latency. Proceed to **Slice 2** (watchlist N-loop coarsening, the
  offender recorded in `compute-route-audit.md`).
