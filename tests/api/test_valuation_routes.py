import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.db import get_db
from tests.api.valuation_fixtures import _case_payload, _narrative

client = TestClient(app)


def test_create_returns_the_new_case_id():
    response = client.post("/api/v1/valuation/cases", json=_case_payload())
    assert response.status_code == 200
    assert response.json()["data"]["id"] > 0


def test_create_without_a_narrative_is_a_422_naming_the_field():
    payload = _case_payload(case_name="unnarrated")
    payload["segments"][0]["narratives"] = [
        n for n in payload["segments"][0]["narratives"]
        if n["input_field"] != "margin_target"
    ]
    response = client.post("/api/v1/valuation/cases", json=payload)
    assert response.status_code == 422
    assert "margin_target" in response.json()["detail"]


def test_list_returns_created_cases():
    client.post("/api/v1/valuation/cases", json=_case_payload(case_name="listed"))
    names = [c["case_name"] for c in client.get("/api/v1/valuation/cases").json()["data"]]
    assert "listed" in names


def test_get_returns_segments_and_narratives():
    case_id = client.post(
        "/api/v1/valuation/cases", json=_case_payload(case_name="detailed")
    ).json()["data"]["id"]
    data = client.get(f"/api/v1/valuation/cases/{case_id}").json()["data"]
    assert data["segments"][0]["name"] == "launch"
    assert data["segments"][0]["narratives"][0]["claim"]


def test_get_unknown_case_is_404():
    assert client.get("/api/v1/valuation/cases/9999").status_code == 404


def test_run_returns_paths_bridge_and_spread():
    case_id = client.post(
        "/api/v1/valuation/cases", json=_case_payload(case_name="runnable")
    ).json()["data"]["id"]
    data = client.post(f"/api/v1/valuation/cases/{case_id}/run").json()["data"]
    assert len(data["fcff"]) == 10
    assert data["revenue"][-1] == pytest.approx(70.0)
    assert data["equity_bridge"]["equity_value"] == pytest.approx(data["equity_value"])
    assert data["terminal_spread"] == pytest.approx(0.0825 - 0.0456)


def test_run_of_an_unknown_case_is_404():
    assert client.post("/api/v1/valuation/cases/9999/run").status_code == 404


def test_model_invalid_inputs_are_422_not_500():
    """A terminal growth above the riskfree rate is a rejected model, not a
    crash. Rejected at creation now, not at run: the write-time engine gate
    (task 1) catches this before the row is ever stored, so there is no
    case_id to run against any more."""
    payload = _case_payload(case_name="uncapped", terminal_growth=0.09)
    response = client.post("/api/v1/valuation/cases", json=payload)
    assert response.status_code == 422
    assert "riskfree" in response.json()["detail"]


def test_create_without_the_equity_bridge_is_a_422():
    """I3: cash, debt, ipo_proceeds and shares_new have no default -- a POST
    that omits the bridge must not silently value a debt-free, cash-free firm
    with no pending raise."""
    payload = _case_payload(case_name="no_bridge")
    for field in ("cash", "debt", "ipo_proceeds", "shares_new"):
        del payload[field]
    response = client.post("/api/v1/valuation/cases", json=payload)
    assert response.status_code == 422


def test_create_rejects_negative_shares_new():
    """I3: a negative shares_new previously produced a diluted value per share
    above basic, which is impossible."""
    payload = _case_payload(case_name="negative_new_shares", shares_new=-5.0)
    response = client.post("/api/v1/valuation/cases", json=payload)
    assert response.status_code == 422


def test_create_rejects_initial_growth_at_or_below_negative_one():
    """Pydantic's Field(gt=-1) on SegmentInput.initial_growth is the bound a real
    client hits, separate from SegmentSpec's own <= -1 rejection in the engine.
    The narrative is included so a 422 here proves the numeric constraint fired,
    not the narrative rule -- without it this would pass for the wrong reason."""
    payload = _case_payload(case_name="growth_at_floor")
    payload["segments"][0]["initial_growth"] = -1.0
    payload["segments"][0]["narratives"].append(_narrative("initial_growth"))
    response = client.post("/api/v1/valuation/cases", json=payload)
    assert response.status_code == 422
    # FastAPI's own request validation, not the narrative rule: detail is a list
    # of Pydantic error objects, and this one names the field via `loc` and the
    # bound via `type`, not a plain string -- unlike the narrative rule's 422s.
    errors = response.json()["detail"]
    assert any(
        error["type"] == "greater_than" and "initial_growth" in error["loc"]
        for error in errors
    )


def test_run_of_a_legacy_unvaluable_row_is_a_422():
    """The write-time gate governs writes only; it cannot retroactively fix a
    row written before it existed, and there is no migration that sweeps for
    one. This stands in for such a row: since no supported path can create an
    unvaluable case any more, this inserts one directly via `get_db()`,
    bypassing `create_case` (and its narrative/engine gates) entirely -- which
    is exactly what a legacy row is. Regression coverage for
    `apps/api/routes/valuation.py`'s `except ValueError -> 422` branch on
    `/run`, which the write-time gate otherwise drives to zero hits across the
    whole suite.
    """
    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO valuation_case (case_name, as_of_date, base_year,"
            " target_year, riskfree_rate, wacc_initial, wacc_stable,"
            " marginal_tax_rate, roic_stable, shares_basic) VALUES"
            " (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "legacy_unvaluable", "2026-08-09", 2026, 2036,
                0.0456, 0.0837, 0.0825, 0.25,
                0.03,  # roic_stable, terminal_growth left NULL -> defaults to
                       # riskfree_rate 0.0456; 0.03 fails to exceed its magnitude.
                12.535,
            ),
        )
        case_id = int(cursor.lastrowid)
        conn.execute(
            "INSERT INTO segment (case_id, name, base_revenue, base_margin,"
            " tam_target, market_share_target, margin_target,"
            " sales_to_capital_early, sales_to_capital_late) VALUES"
            " (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (case_id, "launch", 4.1, -0.10, 100.0, 0.70, 0.45, 1.0, 1.5),
        )

    response = client.post(f"/api/v1/valuation/cases/{case_id}/run")
    assert response.status_code == 422
    assert "terminal growth" in response.json()["detail"]


def test_run_exposes_the_terminal_consistency_diagnostics():
    case_id = client.post(
        "/api/v1/valuation/cases", json=_case_payload(case_name="diagnostics")
    ).json()["data"]["id"]
    data = client.post(f"/api/v1/valuation/cases/{case_id}/run").json()["data"]
    for key in (
        "marginal_roic_target_year",
        "terminal_reinvestment_rate",
        "reinvestment_rate_target_year",
        "explicit_reinvestment_rate_at_stable_growth",
    ):
        assert key in data, key
        assert isinstance(data[key], float)


BILLION = 1_000_000_000.0

_STATEMENT_ROWS = (
    ("income", "Total Revenue", {2024: 90 * BILLION, 2025: 100 * BILLION}),
    ("income", "Operating Income", {2024: 27 * BILLION, 2025: 30 * BILLION}),
    ("balance", "Stockholders Equity", {2024: 25 * BILLION, 2025: 28 * BILLION}),
    ("balance", "Total Debt", {2024: 5 * BILLION, 2025: 5 * BILLION}),
    ("balance", "Cash And Cash Equivalents", {2024: 1 * BILLION, 2025: 1 * BILLION}),
    ("balance", "Diluted Average Shares", {2024: 1 * BILLION, 2025: 1 * BILLION}),
)


def _seed_conservative_inputs(ticker="ROUTE", industry="Semiconductors"):
    """Everything the conservative generator reads, in the isolated test DB.

    The route cannot inject a `bundle_loader`, so the statement bundle has to be
    seeded where the default loader reads it -- `corporate_statements` -- rather
    than passed in as the service-level tests do.
    """
    from apps.api.services.db import get_db
    from apps.api.services.industry_benchmark_store import store_vintage
    from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS

    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO corporate_quote_facts "
            "(ticker, market_cap, shares_outstanding, currency, beta, sector, industry, fetched_at) "
            "VALUES (?, 2.0e11, 1.0e9, 'USD', 1.0, 'Technology', ?, '2026-01-01')",
            (ticker, industry),
        )
        conn.executemany(
            "INSERT OR REPLACE INTO corporate_statements "
            "(ticker, statement_type, frequency, period_end, line_item, value, fetched_at) "
            "VALUES (?, ?, 'annual', ?, ?, ?, '2026-01-01T00:00:00')",
            [
                (ticker, statement_type, f"{year}-12-31", line_item, value)
                for statement_type, line_item, by_year in _STATEMENT_ROWS
                for year, value in by_year.items()
            ],
        )


def test_conservative_case_route_creates_a_case():
    _seed_conservative_inputs()
    response = client.post("/api/v1/valuation/conservative/ROUTE")
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["id"] > 0
    assert body["created"] is True


def test_conservative_case_route_is_idempotent():
    """A repeat call returns the existing case rather than a duplicate-name
    error, so a client retrying after a timeout is safe."""
    _seed_conservative_inputs()
    first = client.post("/api/v1/valuation/conservative/ROUTE").json()["data"]
    second = client.post("/api/v1/valuation/conservative/ROUTE")
    assert second.status_code == 200
    body = second.json()["data"]
    assert body["id"] == first["id"]
    assert body["created"] is False


def test_conservative_case_route_without_a_vintage_is_409():
    """No benchmark dataset loaded is a server-state problem, not a bad ticker:
    a 422 would blame the caller's input for something it did not cause."""
    response = client.post("/api/v1/valuation/conservative/NOVINTAGE")
    assert response.status_code == 409
    assert "no_vintage" in response.json()["detail"]


def test_conservative_case_route_refusal_is_422_naming_the_reason():
    """An unmapped industry is about this ticker, so it is a 422 -- and the
    reason keeps its machine-readable prefix."""
    _seed_conservative_inputs(ticker="WEIRD", industry="Nonexistent Industry")
    response = client.post("/api/v1/valuation/conservative/WEIRD")
    assert response.status_code == 422
    assert "unmapped_industry" in response.json()["detail"]


def test_conservative_case_route_reports_the_stored_name():
    """The reported `case_name` must be the one on the stored row, not a name
    the route rebuilt for itself.

    `generate_conservative_case_for_ticker` resolves a vintage internally and
    returns only `(case_id, reason)`. Rebuilding the name from a second
    `latest_vintage()` call is what `resolve_for_ticker`'s docstring warns
    against: it can disagree with the stored row, and a `None` vintage yields a
    plausible-looking `conservative_<TICKER>_None` that no guard would catch.
    """
    from apps.api.services.valuation_case import load_case

    _seed_conservative_inputs(ticker="NAMED")
    body = client.post("/api/v1/valuation/conservative/NAMED").json()["data"]
    assert body["case_name"] == load_case(body["id"])["case_name"]
    assert "None" not in body["case_name"]


def _seed_verdict_inputs(ticker="VERD", industry="Semiconductors"):
    from apps.api.services.db import get_db

    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO corporate_quote_facts "
            "(ticker, market_cap, shares_outstanding, currency, beta, sector, industry, fetched_at) "
            "VALUES (?, 1.0, 1.0, 'USD', 1.0, 'Technology', ?, '2026-01-01')",
            (ticker, industry),
        )
        conn.executemany(
            "INSERT OR REPLACE INTO stocks (ticker, date, open, high, low, close, volume) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(ticker, f"2025-01-0{i}", 100.0 + i, 100.0 + i, 100.0 + i, 100.0 + i, i * 100)
             for i in range(1, 6)],
        )


def test_verdict_route_returns_a_panel():
    _seed_verdict_inputs()
    response = client.get("/api/v1/valuation/verdict/VERD")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["ticker"] == "VERD"
    assert "anti-conservative" in data["direction"]
    assert "drawdown" in data["rows"]


def test_verdict_route_is_404_when_nothing_is_stored():
    assert client.get("/api/v1/valuation/verdict/NOTHING").status_code == 404


def test_verdict_route_returns_200_with_refused_rows():
    """A partially refused panel is a successful response -- that is the whole
    point of refusing per signal rather than globally."""
    _seed_verdict_inputs(ticker="LONELY")
    data = client.get("/api/v1/valuation/verdict/LONELY").json()["data"]
    # No vintage is loaded in this fixture, so the honest cause is the missing
    # server-wide dataset, not a missing case for this ticker. Before the I6 fix
    # this row said `no_case: LONELY`, sending a reader to debug a ticker that
    # was never the problem -- so asserting `no_case` here passed for the wrong
    # reason. What this test is really about is that refused rows travel inside
    # a 200, which the two assertions here still pin.
    assert data["rows"]["dcf_gap"]["reason"].startswith("no_vintage")
    # This fixture seeds 5 bars, which cannot fill the 252-bar drawdown window,
    # so the row refuses on its own history. `resolve_peers` still runs
    # unconditionally ahead of this block and resolves the peer SET -- only
    # peer BARS are never loaded, since the row refuses before reaching the
    # code that would load them. A refusal about the subject's own bars must
    # not be attributed to the peers (finding I3).
    assert data["rows"]["drawdown"]["reason"].startswith("insufficient_history")


def test_verdict_route_computes_a_drawdown_through_the_real_loader():
    """Every other verdict-route test either injects `bars_loader` or seeds
    only 5 bars, which refuses before the peer-loading loop inside
    `build_verdict` ever runs -- so that loop, against the real
    `load_price_bars`, has no coverage anywhere. Seed enough history for the
    subject and three peers to drive a computed drawdown end to end."""
    import datetime as _dt

    from apps.api.services.db import get_db

    def _seed(ticker, industry="Semiconductors"):
        with get_db() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO corporate_quote_facts "
                "(ticker, market_cap, shares_outstanding, currency, beta, sector, industry, fetched_at) "
                "VALUES (?, 1.0, 1.0, 'USD', 1.0, 'Technology', ?, '2026-01-01')",
                (ticker, industry),
            )
            conn.executemany(
                "INSERT OR REPLACE INTO stocks (ticker, date, open, high, low, close, volume) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                    (ticker, str(_dt.date(2024, 1, 1) + _dt.timedelta(days=i)),
                     100.0, 100.0, 100.0, 100.0, 100)
                    for i in range(260)
                ],
            )

    for t in ("REALDD", "REALDDP1", "REALDDP2", "REALDDP3"):
        _seed(t)

    data = client.get("/api/v1/valuation/verdict/REALDD").json()["data"]
    drawdown = data["rows"]["drawdown"]
    assert drawdown["reason"] is None
    assert drawdown["value"] is not None
