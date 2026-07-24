import httpx
import pytest

from apps.api.compute.client import HttpComputeClient, InProcessComputeClient
from apps.api.compute.errors import ComputeError
from apps.api.compute_service.main import compute_app
from apps.api.models.schemas import AttributionRequest, AttributionResult


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _valid_request() -> AttributionRequest:
    return AttributionRequest(
        tickers=["AAPL", "MSFT", "TSLA"],
        weights=[0.4, 0.4, 0.2],
        benchmark="^GSPC",
        period="1y",
        currency="USD",
        attribution_method="brinson_fachler_arithmetic",
        allow_synthetic_fallback=True,
        allow_benchmark_proxy=True,
    )


def _http_client_against_app() -> HttpComputeClient:
    return HttpComputeClient(
        base_url="http://compute.test",
        connect_timeout=2.0,
        timeout=30.0,
        stream_read_timeout=300.0,
        transport=httpx.ASGITransport(app=compute_app),
    )


@pytest.mark.anyio
async def test_inprocess_client_returns_attribution_result():
    result = await InProcessComputeClient().build_attribution(_valid_request())
    assert isinstance(result, AttributionResult)
    assert result.metadata.method == "brinson_fachler_arithmetic"


@pytest.mark.anyio
async def test_http_client_returns_attribution_result():
    result = await _http_client_against_app().build_attribution(_valid_request())
    assert isinstance(result, AttributionResult)
    assert result.metadata.method == "brinson_fachler_arithmetic"


@pytest.mark.anyio
async def test_both_clients_agree_excluding_variable_fields():
    req = _valid_request()
    a = (await InProcessComputeClient().build_attribution(req)).model_dump()
    b = (await _http_client_against_app().build_attribution(req)).model_dump()
    for blob in (a, b):
        blob["metadata"].pop("generated_at", None)
        blob["metadata"].pop("cache_key", None)
        blob["metadata"].pop("cache_hit", None)
    assert a == b


@pytest.mark.anyio
async def test_inprocess_client_wraps_value_error_as_compute_error():
    bad = AttributionRequest(
        tickers=["ZZZX", "YYYX"], weights=[0.5, 0.5], benchmark="^GSPC",
        period="1y", currency="USD", attribution_method="brinson_fachler_arithmetic",
        allow_synthetic_fallback=False, allow_benchmark_proxy=True,
    )
    with pytest.raises(ComputeError) as exc_info:
        await InProcessComputeClient().build_attribution(bad)
    assert exc_info.value.status_code == 422


@pytest.mark.anyio
async def test_http_client_maps_422_to_compute_error():
    bad = AttributionRequest(
        tickers=["ZZZX", "YYYX"], weights=[0.5, 0.5], benchmark="^GSPC",
        period="1y", currency="USD", attribution_method="brinson_fachler_arithmetic",
        allow_synthetic_fallback=False, allow_benchmark_proxy=True,
    )
    with pytest.raises(ComputeError) as exc_info:
        await _http_client_against_app().build_attribution(bad)
    assert exc_info.value.status_code == 422
    assert "allow_synthetic_fallback=true" in exc_info.value.detail
