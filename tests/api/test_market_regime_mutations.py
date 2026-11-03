"""Mutation harness for test_market_regime_route.py (CLAUDE.md §8, guideline/sop/test-verification.md).

Each case breaks the code in memory with monkeypatch, runs one route test with the same
monkeypatch, and requires it to fail for the named reason. Nothing here writes a source file.
"""

from __future__ import annotations

import contextlib
import inspect
import textwrap

import pytest
from fastapi import HTTPException, Request
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.models.schemas import MarketRegimeContext
from apps.api.services import market_data
from apps.api.services.market_data import MarketDataService
from tests.api import test_market_regime_route as route_tests

_EMPTY_GUARD = "round(equity_advancers / len(equity_quotes), 2) if equity_quotes else None"


def _builder_without_the_empty_guard():
    """The builder as it would be if the `if equity_quotes else None` guard were dropped."""
    source = textwrap.dedent(inspect.getsource(MarketDataService._build_market_regime_context))
    assert source.count(_EMPTY_GUARD) == 1, "anchor moved: re-verify the no-bars test against the new builder"
    namespace = dict(vars(market_data))
    exec(compile(source.replace(_EMPTY_GUARD, "round(equity_advancers / len(equity_quotes), 2)"), market_data.__file__, "exec"), namespace)
    return namespace["_build_market_regime_context"]


def _regime_route_holders(router, url):
    """(router, route) for every route answering `url`, found on the router that really holds it.

    FastAPI >= 0.141 keeps included routers as `_IncludedRouter` wrappers (no `.path`) whose
    `original_router` holds the routes, and `effective_candidates()` lists them with full paths.
    Older FastAPI lists the routes at the top level, which the plain branch covers.
    """
    hits = []
    for route in router.routes:
        if hasattr(route, "original_router"):
            hits += _wrapper_holders(route, url)
        elif getattr(route, "path", None) == url:
            hits.append((router, route))
    return hits


def _wrapper_holders(wrapper, url):
    hits = []
    for candidate in wrapper.effective_candidates():
        if hasattr(candidate, "original_router"):
            hits += _wrapper_holders(candidate, url)
        elif candidate.path == url:
            hits.append((wrapper.original_router, candidate.original_route))
    return hits


@contextlib.contextmanager
def _regime_route_swapped(replacement):
    """Remove the regime route (replacement None) or swap in `replacement(original_path)`; restore after.

    Asserts exactly one route was found, on the router that held it.
    """
    hits = _regime_route_holders(app.router, route_tests.URL)
    assert len(hits) == 1, "the route is registered exactly once"
    holder, original = hits[0]
    index = holder.routes.index(original)
    if replacement is None:
        del holder.routes[index]
    else:
        holder.routes[index] = replacement(original.path)
    getattr(holder, "_mark_routes_changed", lambda: None)()
    try:
        yield
    finally:
        if replacement is None:
            holder.routes.insert(index, original)
        else:
            holder.routes[index] = original
        getattr(holder, "_mark_routes_changed", lambda: None)()


def test_a_wrapper_that_skips_the_builder_fails_the_shape_test(monkeypatch):
    monkeypatch.setattr(MarketDataService, "get_market_regime", lambda self: MarketRegimeContext())
    with pytest.raises(AssertionError, match="regime_label ''"):
        route_tests.test_the_route_returns_the_regime_context_with_every_field_typed(monkeypatch)


def test_an_unregistered_route_fails_the_shape_test(monkeypatch):
    with _regime_route_swapped(None):
        assert TestClient(app).get(route_tests.URL).status_code == 404, "the swap must change what the client sees"
        with pytest.raises(AssertionError, match="status 404"):
            route_tests.test_the_route_returns_the_regime_context_with_every_field_typed(monkeypatch)


def test_a_builder_without_the_empty_guard_fails_the_no_bars_test(monkeypatch):
    monkeypatch.setattr(MarketDataService, "_build_market_regime_context", _builder_without_the_empty_guard())
    with pytest.raises(ZeroDivisionError):
        route_tests.test_no_bars_is_an_unknown_regime_with_200_not_an_error(monkeypatch)


def test_counting_vix_as_an_equity_index_fails_the_vix_test(monkeypatch):
    monkeypatch.setattr(market_data, "EQUITY_INDEX_TICKERS", (*market_data.EQUITY_INDEX_TICKERS, "^VIX"))
    with pytest.raises(AssertionError, match="equity_index_count 2"):
        route_tests.test_vix_bars_are_not_counted_as_an_equity_index(monkeypatch)


def test_a_route_that_rejects_unknown_query_parameters_fails_the_unknown_parameter_test(monkeypatch):
    def strict(request: Request):
        if request.query_params:
            raise HTTPException(status_code=422, detail="unknown query parameter")
        return MarketRegimeContext()

    with _regime_route_swapped(lambda path: APIRoute(path, strict, methods=["GET"], response_model=MarketRegimeContext)):
        assert TestClient(app).get(route_tests.URL, params={"x": "1"}).status_code == 422, "the swap must change what the client sees"
        with pytest.raises(AssertionError, match="status 422"):
            route_tests.test_unknown_query_parameters_are_ignored(monkeypatch)
