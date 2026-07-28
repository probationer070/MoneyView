# scripts/benchmark_compute_hop.py
"""Measure the added latency of the compute hop for POST /portfolio/attribution.

Compares InProcessComputeClient vs HttpComputeClient (over loopback ASGI transport,
which is the closest in-test analogue to the two-process split). For the true
two-process number, run compute-service on :8600 and set BASE_URL below.

Usage: python scripts/benchmark_compute_hop.py [iterations]
"""
from __future__ import annotations

import asyncio
import statistics
import sys
import time

import httpx

from apps.api.compute.client import HttpComputeClient, InProcessComputeClient
from apps.api.compute_service.main import compute_app
from apps.api.models.schemas import AttributionRequest


def _req() -> AttributionRequest:
    return AttributionRequest(
        tickers=["AAPL", "MSFT", "TSLA"], weights=[0.4, 0.4, 0.2], benchmark="^GSPC",
        period="1y", currency="USD", attribution_method="brinson_fachler_arithmetic",
        allow_synthetic_fallback=True, allow_benchmark_proxy=True,
    )


async def _time_client(client, req, iterations: int) -> list[float]:
    samples = []
    await client.build_attribution(req)  # warm caches
    for _ in range(iterations):
        start = time.perf_counter()
        await client.build_attribution(req)
        samples.append((time.perf_counter() - start) * 1000)
    return samples


def _p95(samples: list[float]) -> float:
    ordered = sorted(samples)
    return ordered[max(0, int(len(ordered) * 0.95) - 1)]


async def main(iterations: int) -> None:
    req = _req()
    inproc = await _time_client(InProcessComputeClient(), req, iterations)
    http = await _time_client(
        HttpComputeClient(
            base_url="http://compute.test", connect_timeout=2.0, timeout=30.0,
            stream_read_timeout=300.0, transport=httpx.ASGITransport(app=compute_app),
        ),
        req,
        iterations,
    )
    added_p50 = statistics.median(http) - statistics.median(inproc)
    added_p95 = _p95(http) - _p95(inproc)
    print(f"iterations={iterations}")
    print(f"inprocess  p50={statistics.median(inproc):.2f}ms  p95={_p95(inproc):.2f}ms")
    print(f"http(loop) p50={statistics.median(http):.2f}ms  p95={_p95(http):.2f}ms")
    print(f"ADDED HOP  p50={added_p50:.2f}ms  p95={added_p95:.2f}ms")
    print(f"go/no-go (<15ms p95 loopback): {'PASS' if added_p95 < 15 else 'FAIL'}")


if __name__ == "__main__":
    iters = int(sys.argv[1]) if len(sys.argv) > 1 else 100
    asyncio.run(main(iters))
