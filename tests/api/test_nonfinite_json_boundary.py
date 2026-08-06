"""JSON has no NaN/Inf, so a non-finite float in a response body is a 500 waiting to happen.

`json.dumps(..., allow_nan=False)` -- what Starlette's JSONResponse renders with -- raises
`ValueError: Out of range float values are not JSON compliant` rather than emitting a bare
`NaN` token. See ERROR-LOG.md (2026-07-26): a live index whose data yielded a NaN took the
whole `/market/indices` card list down with a 500.

Non-finite means "no number here", so it serializes as `null`. Substituting 0.0 would be a
different claim -- guideline/sop/finance-logic.md forbids standing a real figure in for an
absent one.
"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.core.responses import null_nonfinite
from apps.api.main import app
from apps.api.models.schemas import DeltaBadge, IndexQuote
from apps.api.routes import corporate as corporate_routes
from apps.api.routes import market as market_routes


def _quote_carrying_nonfinite_values() -> IndexQuote:
    """An index card shaped exactly as get_all_indices builds it, but non-finite.

    DeltaBadge.compute guards `prev_value == 0`, so division is not how NaN gets in: a
    NaN close arrives from the data and flows into value/delta_abs/delta_pct untouched.
    The sparkline filter is `if b.close is not None`, which NaN passes.
    """
    return IndexQuote(
        name="S&P 500",
        ticker="^GSPC",
        last_close=float("nan"),
        delta=DeltaBadge(
            value=float("nan"),
            prev_value=100.0,
            delta_abs=float("nan"),
            delta_pct=float("-inf"),
            direction="flat",
            color="gray",
        ),
        sparkline=[100.0, float("nan"), 102.0],
    )


def test_indices_renders_a_nonfinite_value_as_null_instead_of_500(monkeypatch):
    monkeypatch.setattr(
        market_routes._svc,
        "get_all_indices",
        lambda: [_quote_carrying_nonfinite_values()],
    )

    # raise_server_exceptions=False so a serialization failure arrives as the 500 a real
    # client would see, rather than as an exception raised inside the test.
    client = TestClient(app, raise_server_exceptions=False)
    response = client.get("/api/v1/market/indices")

    assert response.status_code == 200

    card = response.json()[0]
    assert card["last_close"] is None
    assert card["delta"]["delta_abs"] is None
    assert card["delta"]["delta_pct"] is None
    # The finite neighbours survive, and the gap keeps its position: dropping the point
    # would silently shift every later point one step along the x axis.
    assert card["sparkline"] == [100.0, None, 102.0]
    assert card["delta"]["prev_value"] == 100.0


def test_a_route_without_a_response_model_renders_nonfinite_as_null_not_500(monkeypatch):
    """The exposed half of the same hazard.

    A route declaring `response_model=` is serialized by pydantic's own JSON writer, which
    already emits `null` for non-finite floats -- that is why the indices case above passes.
    A route without one falls back to `jsonable_encoder` plus Starlette's
    `json.dumps(allow_nan=False)`, which raises. Same defect, decided by whether the route
    happens to declare a model.
    """
    monkeypatch.setattr(
        corporate_routes.corporate_metrics_service,
        "metric_history",
        lambda ticker, **kwargs: {"ticker": ticker, "roic": [1.5, float("nan")]},
    )

    client = TestClient(app, raise_server_exceptions=False)
    response = client.get("/api/v1/corporate/metrics/AAPL/history")

    assert response.status_code == 200
    assert response.json()["roic"] == [1.5, None]


def test_null_nonfinite_replaces_each_non_finite_form_wherever_it_is_nested():
    payload = {
        "nan": float("nan"),
        "inf": float("inf"),
        "neg_inf": float("-inf"),
        "nested": {"series": [1.0, float("nan"), {"deep": float("inf")}]},
    }

    assert null_nonfinite(payload) == {
        "nan": None,
        "inf": None,
        "neg_inf": None,
        "nested": {"series": [1.0, None, {"deep": None}]},
    }


def test_null_nonfinite_leaves_every_finite_and_non_float_value_alone():
    """Guards the other direction: a sanitizer that nulls too much is its own defect.

    Widening the float check to `(int, float)` would NOT fail this test -- no Python int
    or bool can be non-finite, so that mutation changes nothing. What this does catch is a
    walk that rewrites values it was never asked to touch, and it pins 0.0 in particular:
    a real zero must survive, since the whole point of choosing null was to keep "absent"
    and "zero" distinguishable.
    """
    payload = {
        "zero": 0.0,
        "negative": -1.5,
        "int": 7,
        "true": True,
        "false": False,
        "none": None,
        "text": "nan",
        "empty": [],
    }

    assert null_nonfinite(payload) == payload
