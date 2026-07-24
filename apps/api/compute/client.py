# apps/api/compute/client.py
"""The compute seam. One typed client localises the transport choice to one place."""
from __future__ import annotations

import asyncio
from typing import Protocol

import httpx

from apps.api.compute.config import (
    compute_client_mode,
    compute_connect_timeout,
    compute_service_base_url,
    compute_stream_read_timeout,
    compute_timeout,
)
from apps.api.compute.errors import ComputeError
from apps.api.compute.serialization import dumps_model, loads_model
from apps.api.core.dev_monitor import get_current_request_id
from apps.api.models.schemas import AttributionRequest, AttributionResult
from apps.api.services.market_data import MarketDataService
from apps.api.services.portfolio_service import PortfolioAnalyticsService

_ATTRIBUTION_PATH = "/compute/portfolio/attribution"


class ComputeClient(Protocol):
    async def build_attribution(self, request: AttributionRequest) -> AttributionResult: ...


class InProcessComputeClient:
    """Calls services directly — identical behaviour to today. Migration control."""

    def __init__(self, analytics: PortfolioAnalyticsService | None = None):
        self._analytics = analytics or PortfolioAnalyticsService(MarketDataService())

    async def build_attribution(self, request: AttributionRequest) -> AttributionResult:
        try:
            return await asyncio.to_thread(self._analytics.build_attribution, request)
        except ValueError as exc:
            raise ComputeError(status_code=422, detail=str(exc)) from exc


class HttpComputeClient:
    """The real network split. build_attribution is non-retryable (idempotent, not cheap)."""

    def __init__(
        self,
        base_url: str,
        connect_timeout: float,
        timeout: float,
        stream_read_timeout: float,
        transport: httpx.ASGITransport | None = None,
    ):
        self._base_url = base_url
        self._timeout = httpx.Timeout(timeout, connect=connect_timeout)
        self._stream_read_timeout = stream_read_timeout
        self._transport = transport

    def _new_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self._base_url, timeout=self._timeout, transport=self._transport)

    async def build_attribution(self, request: AttributionRequest) -> AttributionResult:
        headers = {"content-type": "application/json"}
        request_id = get_current_request_id()
        if request_id:
            headers["X-Request-ID"] = request_id
        async with self._new_client() as client:
            resp = await client.post(_ATTRIBUTION_PATH, content=dumps_model(request), headers=headers)
        if resp.status_code == 200:
            return loads_model(AttributionResult, resp.text)
        detail = _extract_detail(resp)
        raise ComputeError(status_code=resp.status_code, detail=detail)


def _extract_detail(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        if isinstance(body, dict) and "detail" in body:
            return str(body["detail"])
    except Exception:
        pass
    return resp.text or f"compute-service returned {resp.status_code}"


_test_client_override: ComputeClient | None = None


def set_compute_client_for_test(client: ComputeClient) -> None:
    global _test_client_override
    _test_client_override = client


def reset_compute_client() -> None:
    global _test_client_override
    _test_client_override = None


_inprocess_singleton: InProcessComputeClient | None = None


def get_compute_client() -> ComputeClient:
    if _test_client_override is not None:
        return _test_client_override
    if compute_client_mode() == "http":
        return HttpComputeClient(
            base_url=compute_service_base_url(),
            connect_timeout=compute_connect_timeout(),
            timeout=compute_timeout(),
            stream_read_timeout=compute_stream_read_timeout(),
        )
    # Reuse one in-process client so the underlying PortfolioAnalyticsService and
    # its per-instance attribution cache are preserved across requests — matching
    # today's module-level `_portfolio_analytics` singleton in routes/portfolio.py.
    global _inprocess_singleton
    if _inprocess_singleton is None:
        _inprocess_singleton = InProcessComputeClient()
    return _inprocess_singleton
