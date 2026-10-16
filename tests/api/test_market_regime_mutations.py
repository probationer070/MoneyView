"""Mutation harness for test_market_regime_route.py (CLAUDE.md §8, guideline/sop/test-verification.md).

Each case breaks the code in memory with monkeypatch, runs one route test with the same
monkeypatch, and requires it to fail for the named reason. Nothing here writes a source file.
"""

from __future__ import annotations

import inspect
import textwrap

import pytest

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


def test_a_wrapper_that_skips_the_builder_fails_the_shape_test(monkeypatch):
    monkeypatch.setattr(MarketDataService, "get_market_regime", lambda self: MarketRegimeContext())
    with pytest.raises(AssertionError, match="regime_label ''"):
        route_tests.test_the_route_returns_the_regime_context_with_every_field_typed(monkeypatch)


def test_an_unregistered_route_fails_the_shape_test(monkeypatch):
    kept = [route for route in app.router.routes if getattr(route, "path", None) != route_tests.URL]
    assert len(kept) == len(app.router.routes) - 1, "the route is registered exactly once"
    monkeypatch.setattr(app.router, "routes", kept)
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
