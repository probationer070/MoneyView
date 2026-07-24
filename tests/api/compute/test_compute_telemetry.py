import httpx
import pytest

from apps.api.compute.client import HttpComputeClient
from apps.api.compute_service.main import compute_app
from apps.api.core import dev_monitor
from apps.api.models.schemas import AttributionRequest


@pytest.fixture
def anyio_backend():
    return "asyncio"


class _CapturingSink(dev_monitor.DevMonitorSink):
    def __init__(self):
        self.events = []

    def emit(self, event):
        self.events.append(event)
        return event


@pytest.fixture
def capture(monkeypatch):
    sink = _CapturingSink()
    monkeypatch.setattr(dev_monitor, "_sink", sink)
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR", "true")
    return sink


def _req() -> AttributionRequest:
    return AttributionRequest(
        tickers=["AAPL", "MSFT", "TSLA"], weights=[0.4, 0.4, 0.2], benchmark="^GSPC",
        period="1y", currency="USD", attribution_method="brinson_fachler_arithmetic",
        allow_synthetic_fallback=True, allow_benchmark_proxy=True,
    )


@pytest.mark.anyio
async def test_http_client_emits_three_bucket_event(capture):
    client = HttpComputeClient(
        base_url="http://compute.test", connect_timeout=2.0, timeout=30.0,
        stream_read_timeout=300.0, transport=httpx.ASGITransport(app=compute_app),
    )
    await client.build_attribution(_req())

    events = [e for e in capture.events if e.operation == "compute_client.build_attribution"]
    assert len(events) == 1
    meta = events[0].metadata
    assert meta["mode"] == "http"
    assert "serialization_ms" in meta
    assert "compute_ms" in meta
    assert "wire_estimated_ms" in meta
    assert meta["payload_bytes"] > 0
    assert events[0].scope == "external"
