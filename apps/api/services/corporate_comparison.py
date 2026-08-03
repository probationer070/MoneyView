from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable
from zoneinfo import ZoneInfo

from apps.api.core.dev_monitor import perf_timer
from apps.api.models.schemas import (
    CorporateComparisonHistoryPoint,
    CorporateComparisonHistoryResponse,
    CorporateComparisonResponse,
    CorporateComparisonRow,
    CorporateComparisonSnapshotMeta,
    CorporateComparisonStockHistoryPoint,
    CorporateComparisonStockHistoryResponse,
    CorporateMetrics,
)
from apps.api.services.acquisition.runner import acquire_point_in_time
from apps.api.services.acquisition.sources.quote_facts import fetch_quote_facts
from apps.api.services.acquisition.sources.statements import fetch_statements
from apps.api.services.acquisition.store import save_quote_facts, save_statements, statement_coverage
from apps.api.services.corporate_statement_metrics import _pick_worst_quality
from apps.api.services.db import get_db
from apps.api.services.equity_bridge import load_equity_bridge
from packages.core_finance.dcf import calculate_equity_value, calculate_intrinsic_value_per_share
from packages.core_finance.expected_return import (
    ExpectedReturnInputs,
    calculate_expected_return_result,
    calculate_market_expected_return,
)

KST = ZoneInfo("Asia/Seoul")
SNAPSHOT_RETENTION_DAYS = 365
SNAPSHOT_CADENCE = "daily_kst_0000"
STOCK_EXPECTED_RETURN_METHOD = "dcf_implied_upside"
REFERENCE_EXPECTED_RETURN_METHOD = "capm_beta_reference"
DEFAULT_SNAPSHOT_MODE = "snapshot"
DEFAULT_COMPARISON_UNIVERSE = "portfolio_plus_benchmark"
DEFAULT_BENCHMARK_TICKER = "^GSPC"
BENCHMARK_GROUP_NAME = "benchmark"
DEFAULT_TAX_RATE = 0.21

# Bumped by hand whenever metric SEMANTICS change -- a formula, a fallback, an input
# source. Not a database schema version and not a payload format version. It exists
# because snapshots are immutable and comparable: two computed by different metric code
# are not like for like, and the comparison feature must be able to see that.
METRIC_SCHEMA_VERSION = 2


@dataclass(frozen=True)
class CompanyUniverseData:
    registry: dict[str, dict[str, object]]
    watchlist_rows: list[dict[str, object]]


def build_corporate_comparison_response(
    *,
    mode: str,
    comparison_universe: str,
    benchmark_ticker: str,
    custom_tickers: list[str],
    metrics_loader: Callable[..., CorporateMetrics],
    price_loader: Callable[[str], float],
    default_companies: dict[str, dict[str, str]],
    risk_free_rate: float,
    equity_risk_premium: float,
) -> CorporateComparisonResponse:
    latest_snapshot_meta = _load_latest_snapshot_meta(
        comparison_universe=comparison_universe,
        benchmark_ticker=benchmark_ticker,
        custom_tickers=custom_tickers,
    )

    if mode == "live":
        live = _build_live_response(
            comparison_universe=comparison_universe,
            benchmark_ticker=benchmark_ticker,
            custom_tickers=custom_tickers,
            metrics_loader=metrics_loader,
            price_loader=price_loader,
            default_companies=default_companies,
            risk_free_rate=risk_free_rate,
            equity_risk_premium=equity_risk_premium,
        )
        live.snapshot.snapshot_available = latest_snapshot_meta is not None
        if latest_snapshot_meta is not None:
            live.snapshot.snapshot_source = str(latest_snapshot_meta["snapshot_source"] or "")
            live.snapshot.snapshot_version = str(latest_snapshot_meta["snapshot_version"] or "")
        return live

    # Reads never write. The former fallback computed and persisted a snapshot when today's
    # was missing, which put a multi-minute live sweep inside a request the user never made.
    # Snapshot creation is exclusively user-initiated now.
    latest = _load_latest_snapshot_response(
        comparison_universe=comparison_universe,
        benchmark_ticker=benchmark_ticker,
        custom_tickers=custom_tickers,
    )
    if latest is not None:
        return latest
    return _empty_snapshot_response(
        comparison_universe=comparison_universe,
        benchmark_ticker=benchmark_ticker,
        custom_tickers=custom_tickers,
        risk_free_rate=risk_free_rate,
        equity_risk_premium=equity_risk_premium,
    )


def _empty_snapshot_response(
    *,
    comparison_universe: str,
    benchmark_ticker: str,
    custom_tickers: list[str],
    risk_free_rate: float,
    equity_risk_premium: float,
) -> CorporateComparisonResponse:
    """The explicit empty state for `mode=snapshot` when no snapshot has ever been taken."""
    return CorporateComparisonResponse(
        market_expected_return=_market_expected_return_pct(risk_free_rate, equity_risk_premium),
        risk_free_rate=round(risk_free_rate * 100, 2),
        equity_risk_premium=round(equity_risk_premium * 100, 2),
        stock_expected_return_method=STOCK_EXPECTED_RETURN_METHOD,
        comparison_reference_return_method=REFERENCE_EXPECTED_RETURN_METHOD,
        snapshot=CorporateComparisonSnapshotMeta(
            mode="snapshot",
            snapshot_version="",
            snapshot_available=False,
            snapshot_source="",
            comparison_universe=comparison_universe,
            benchmark_ticker=_normalize_benchmark_ticker(benchmark_ticker),
            custom_tickers=_normalize_custom_tickers(custom_tickers),
            snapshot_cadence=SNAPSHOT_CADENCE,
            snapshot_retention_days=SNAPSHOT_RETENTION_DAYS,
            snapshot_is_stale=False,
        ),
        rows=[],
    )


def save_corporate_comparison_snapshot(
    *,
    snapshot_source: str,
    comparison_universe: str,
    benchmark_ticker: str,
    custom_tickers: list[str],
    metrics_loader: Callable[..., CorporateMetrics],
    price_loader: Callable[[str], float],
    default_companies: dict[str, dict[str, str]],
    risk_free_rate: float,
    equity_risk_premium: float,
) -> CorporateComparisonResponse:
    response = _build_live_response(
        comparison_universe=comparison_universe,
        benchmark_ticker=benchmark_ticker,
        custom_tickers=custom_tickers,
        metrics_loader=metrics_loader,
        price_loader=price_loader,
        default_companies=default_companies,
        risk_free_rate=risk_free_rate,
        equity_risk_premium=equity_risk_premium,
    )
    snapshot_date = _snapshot_business_date()
    snapshot_taken_at = _now_utc().isoformat()
    normalized_benchmark = _normalize_benchmark_ticker(benchmark_ticker)
    normalized_custom_tickers = _normalize_custom_tickers(custom_tickers)
    universe_key = _comparison_universe_key(
        comparison_universe=comparison_universe,
        benchmark_ticker=normalized_benchmark,
        custom_tickers=normalized_custom_tickers,
    )
    snapshot_version = _snapshot_version_id(universe_key=universe_key, snapshot_taken_at=snapshot_taken_at)

    with get_db() as conn:
        for row in response.rows:
            conn.execute(
                """INSERT INTO corporate_comparison_snapshots_v3 (
                       snapshot_version, snapshot_date, universe_key, comparison_universe, benchmark_ticker,
                       custom_tickers, snapshot_taken_at, snapshot_source, risk_free_rate,
                       equity_risk_premium, stock_expected_return_method, ticker, name, sector,
                       group_name, weight, roic, wacc, roic_minus_wacc, dcf_value, current_price,
                       dcf_implied_return, capm_expected_return, stock_expected_return,
                       market_expected_return, expected_return_spread, stock_expected_return_source,
                       has_price_data, metric_schema_version, bridge_quality
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    snapshot_version,
                    snapshot_date,
                    universe_key,
                    comparison_universe,
                    normalized_benchmark,
                    ",".join(normalized_custom_tickers),
                    snapshot_taken_at,
                    snapshot_source,
                    round(risk_free_rate * 100, 2),
                    round(equity_risk_premium * 100, 2),
                    STOCK_EXPECTED_RETURN_METHOD,
                    row.ticker,
                    row.name,
                    row.sector,
                    row.group_name,
                    row.weight,
                    row.roic,
                    row.wacc,
                    row.roic_minus_wacc,
                    row.dcf_value,
                    row.current_price,
                    row.dcf_implied_return,
                    row.capm_expected_return,
                    row.stock_expected_return,
                    row.market_expected_return,
                    row.expected_return_spread,
                    row.stock_expected_return_source,
                    1 if row.has_price_data else 0,
                    METRIC_SCHEMA_VERSION,
                    row.bridge_quality,
                ),
            )
        conn.execute(
            "DELETE FROM corporate_comparison_snapshots_v3 WHERE snapshot_date < ?",
            ((_now_kst() - timedelta(days=SNAPSHOT_RETENTION_DAYS)).date().isoformat(),),
        )

    response.snapshot = CorporateComparisonSnapshotMeta(
        mode="snapshot",
        as_of_date=snapshot_date,
        generated_at=snapshot_taken_at,
        snapshot_version=snapshot_version,
        snapshot_available=bool(response.rows),
        snapshot_source=snapshot_source,
        comparison_universe=comparison_universe,
        benchmark_ticker=normalized_benchmark,
        custom_tickers=normalized_custom_tickers,
        snapshot_cadence=SNAPSHOT_CADENCE,
        snapshot_retention_days=SNAPSHOT_RETENTION_DAYS,
        snapshot_is_stale=False,
    )
    return response


def _build_live_response(
    *,
    comparison_universe: str,
    benchmark_ticker: str,
    custom_tickers: list[str],
    metrics_loader: Callable[..., CorporateMetrics],
    price_loader: Callable[[str], float],
    default_companies: dict[str, dict[str, str]],
    risk_free_rate: float,
    equity_risk_premium: float,
) -> CorporateComparisonResponse:
    rows = _build_live_rows(
        comparison_universe=comparison_universe,
        benchmark_ticker=benchmark_ticker,
        custom_tickers=custom_tickers,
        metrics_loader=metrics_loader,
        price_loader=price_loader,
        default_companies=default_companies,
        risk_free_rate=risk_free_rate,
        equity_risk_premium=equity_risk_premium,
    )
    generated_at = _now_utc().isoformat()
    return CorporateComparisonResponse(
        market_expected_return=_market_expected_return_pct(risk_free_rate, equity_risk_premium),
        risk_free_rate=round(risk_free_rate * 100, 2),
        equity_risk_premium=round(equity_risk_premium * 100, 2),
        stock_expected_return_method=STOCK_EXPECTED_RETURN_METHOD,
        comparison_reference_return_method=REFERENCE_EXPECTED_RETURN_METHOD,
        snapshot=CorporateComparisonSnapshotMeta(
            mode="live",
            as_of_date=_snapshot_business_date(),
            generated_at=generated_at,
            snapshot_version="",
            snapshot_available=False,
            snapshot_source="",
            comparison_universe=comparison_universe,
            benchmark_ticker=_normalize_benchmark_ticker(benchmark_ticker),
            custom_tickers=_normalize_custom_tickers(custom_tickers),
            snapshot_cadence=SNAPSHOT_CADENCE,
            snapshot_retention_days=SNAPSHOT_RETENTION_DAYS,
            snapshot_is_stale=False,
        ),
        rows=rows,
    )


def _build_live_rows(
    *,
    comparison_universe: str,
    benchmark_ticker: str,
    custom_tickers: list[str],
    metrics_loader: Callable[..., CorporateMetrics],
    price_loader: Callable[[str], float],
    default_companies: dict[str, dict[str, str]],
    risk_free_rate: float,
    equity_risk_premium: float,
) -> list[CorporateComparisonRow]:
    company_data = load_company_universe_data(default_companies)
    universe_rows = _resolve_comparison_universe_rows(
        comparison_universe=comparison_universe,
        benchmark_ticker=benchmark_ticker,
        custom_tickers=custom_tickers,
        company_registry=company_data.registry,
        watchlist_payload=company_data.watchlist_rows,
    )

    rows: list[CorporateComparisonRow] = []
    with perf_timer(
        scope="calculation",
        operation="fanout.comparison",
        emit_start=True,
    ) as span_metadata:
        span_metadata["fanout_size"] = len(universe_rows)
        for row in universe_rows:
            ticker = str(row["ticker"] or "").upper().strip()
            if not ticker:
                continue
            metrics = metrics_loader(ticker)
            dcf = _dcf_snapshot(
                ticker=ticker,
                metrics=metrics,
                price_loader=price_loader,
                risk_free_rate=risk_free_rate,
                equity_risk_premium=equity_risk_premium,
            )
            rows.append(
                CorporateComparisonRow(
                    ticker=ticker,
                    name=str(row["name"] or company_data.registry.get(ticker, {}).get("name") or ticker),
                    sector=str(row["sector"] or company_data.registry.get(ticker, {}).get("sector", "")),
                    group_name=str(row["group_name"] or "custom"),
                    weight=float(row["weight"] or 0.0),
                    roic=round(float(metrics.roic), 2),
                    wacc=round(float(metrics.wacc), 2),
                    roic_minus_wacc=round(float(metrics.roic - metrics.wacc), 2),
                    dcf_value=float(dcf["estimated_value"]),
                    current_price=float(dcf["current_price"]),
                    dcf_implied_return=float(dcf["dcf_implied_return"]),
                    capm_expected_return=float(dcf["capm_expected_return"]),
                    stock_expected_return=float(dcf["stock_expected_return"]),
                    market_expected_return=float(dcf["market_expected_return"]),
                    expected_return_spread=float(dcf["expected_return_spread"]),
                    stock_expected_return_source=STOCK_EXPECTED_RETURN_METHOD,
                    has_price_data=float(dcf["current_price"]) > 0,
                    bridge_quality=str(dcf["bridge_quality"]),
                )
            )
    return rows


def _dcf_snapshot(
    *,
    ticker: str,
    metrics: CorporateMetrics,
    price_loader: Callable[[str], float],
    risk_free_rate: float,
    equity_risk_premium: float,
    bridge_loader=load_equity_bridge,
) -> dict[str, float | str]:
    with perf_timer(scope="calculation", operation="calculation.dcf_upside", ticker=ticker, component="corporate_comparison"):
        current_price = price_loader(ticker)
        base_fcff = max(float(metrics.fcff), 1.0)
        wacc = max(float(metrics.wacc) / 100, 0.001)
        growth_rate = float(metrics.growth) / 100
        terminal_growth = min(growth_rate, wacc - 0.005)
        terminal_growth = max(terminal_growth, -0.1)

        projected_fcff = [base_fcff * ((1 + growth_rate) ** year) for year in range(1, 6)]
        pv_fcff = sum(cash_flow / ((1 + wacc) ** year) for year, cash_flow in enumerate(projected_fcff, start=1))
        terminal_cash_flow = projected_fcff[-1] * (1 + terminal_growth)
        terminal_value = terminal_cash_flow / max(wacc - terminal_growth, 0.005)
        pv_terminal = terminal_value / ((1 + wacc) ** 5)
        enterprise_value = pv_fcff + pv_terminal

        bridge = bridge_loader(ticker)
        net_debt = bridge.net_debt.value
        non_operating_assets = bridge.non_operating_assets.value
        shares = bridge.diluted_shares_outstanding.value
        bridge_quality = _pick_worst_quality(
            bridge.net_debt.quality,
            bridge.non_operating_assets.quality,
            bridge.diluted_shares_outstanding.quality,
        )
        equity_value = (
            calculate_equity_value(
                enterprise_value=enterprise_value,
                net_debt=net_debt,
                non_operating_assets=non_operating_assets or 0.0,
            )
            if net_debt is not None
            else None
        )
        intrinsic_value_per_share = (
            calculate_intrinsic_value_per_share(equity_value, shares)
            if equity_value is not None and shares is not None and shares > 0
            else None
        )
        estimated_value = (
            intrinsic_value_per_share
            if intrinsic_value_per_share is not None
            else enterprise_value
        )

    with perf_timer(scope="metric", operation="metric.expected_vs_market", ticker=ticker, component="corporate_comparison"):
        expected_returns = calculate_expected_return_result(
            ExpectedReturnInputs(
                current_price=current_price,
                # The real intrinsic value, not the current price. Passing the price made
                # dcf_implied_return = f(price, price) = 0, and stock_expected_return is
                # assigned from it, so three columns were constant for every ticker.
                intrinsic_value=(
                    intrinsic_value_per_share
                    if intrinsic_value_per_share is not None
                    else current_price
                ),
                risk_free_rate=risk_free_rate,
                equity_risk_premium=equity_risk_premium,
                beta=_levered_beta_from_metrics(metrics),
            )
        )

    return {
        "estimated_value": round(float(estimated_value), 2),
        "current_price": round(float(current_price), 2),
        "dcf_implied_return": round(float(expected_returns.dcf_implied_return * 100), 2),
        "capm_expected_return": round(float(expected_returns.capm_expected_return * 100), 2),
        "stock_expected_return": round(float(expected_returns.stock_expected_return * 100), 2),
        "market_expected_return": round(float(expected_returns.market_expected_return * 100), 2),
        "expected_return_spread": round(float(expected_returns.expected_return_spread * 100), 2),
        "status": (
            "Bridge Incomplete"
            if intrinsic_value_per_share is None
            else "Undervalued" if current_price > 0 and intrinsic_value_per_share > current_price
            else "Overvalued"
        ),
        "bridge_quality": bridge_quality,
    }


def _rounded_or_none(value: object) -> float | None:
    """Round a SQL aggregate, preserving NULL as None rather than collapsing it to 0.0."""
    return None if value is None else round(float(value), 2)


def _market_expected_return_pct(risk_free_rate: float, equity_risk_premium: float) -> float:
    return round(calculate_market_expected_return(risk_free_rate, equity_risk_premium) * 100, 2)


def _load_snapshot_response(
    *,
    snapshot_date: str,
    comparison_universe: str,
    benchmark_ticker: str,
    custom_tickers: list[str],
) -> CorporateComparisonResponse | None:
    normalized_benchmark = _normalize_benchmark_ticker(benchmark_ticker)
    normalized_custom_tickers = _normalize_custom_tickers(custom_tickers)
    universe_key = _comparison_universe_key(
        comparison_universe=comparison_universe,
        benchmark_ticker=normalized_benchmark,
        custom_tickers=normalized_custom_tickers,
    )
    with get_db() as conn:
        version_row = conn.execute(
            """SELECT snapshot_version
               FROM corporate_comparison_snapshots_v3
               WHERE snapshot_date = ? AND universe_key = ?
               ORDER BY snapshot_taken_at DESC, snapshot_version DESC
               LIMIT 1""",
            (snapshot_date, universe_key),
        ).fetchone()
        if version_row is None:
            return None
        rows = conn.execute(
            """SELECT snapshot_version, snapshot_date, snapshot_taken_at, snapshot_source, comparison_universe,
                      benchmark_ticker, custom_tickers, ticker, name, sector, group_name,
                      risk_free_rate, equity_risk_premium, stock_expected_return_method,
                      weight, roic, wacc, roic_minus_wacc, dcf_value, current_price,
                      dcf_implied_return, capm_expected_return, stock_expected_return,
                      market_expected_return, expected_return_spread, stock_expected_return_source,
                      has_price_data, bridge_quality
               FROM corporate_comparison_snapshots_v3
               WHERE snapshot_version = ?
               ORDER BY group_name, ticker""",
            (str(version_row["snapshot_version"]),),
        ).fetchall()
    return _rows_to_response(rows)


def _load_latest_snapshot_response(
    *,
    comparison_universe: str,
    benchmark_ticker: str,
    custom_tickers: list[str],
) -> CorporateComparisonResponse | None:
    latest = _load_latest_snapshot_meta(
        comparison_universe=comparison_universe,
        benchmark_ticker=benchmark_ticker,
        custom_tickers=custom_tickers,
    )
    if latest is None:
        return None
    return _load_snapshot_response(
        snapshot_date=str(latest["snapshot_date"]),
        comparison_universe=comparison_universe,
        benchmark_ticker=benchmark_ticker,
        custom_tickers=custom_tickers,
    )


def _load_latest_snapshot_meta(
    *,
    comparison_universe: str,
    benchmark_ticker: str,
    custom_tickers: list[str],
) -> dict[str, object] | None:
    universe_key = _comparison_universe_key(
        comparison_universe=comparison_universe,
        benchmark_ticker=_normalize_benchmark_ticker(benchmark_ticker),
        custom_tickers=_normalize_custom_tickers(custom_tickers),
    )
    with get_db() as conn:
        latest = conn.execute(
            """SELECT snapshot_version, snapshot_date, snapshot_taken_at, snapshot_source
               FROM corporate_comparison_snapshots_v3
               WHERE universe_key = ?
               ORDER BY snapshot_date DESC, snapshot_taken_at DESC
               LIMIT 1""",
            (universe_key,),
        ).fetchone()
        if latest is None:
            return None
        return {
            "snapshot_version": str(latest["snapshot_version"]),
            "snapshot_date": str(latest["snapshot_date"]),
            "snapshot_taken_at": str(latest["snapshot_taken_at"]),
            "snapshot_source": str(latest["snapshot_source"] or ""),
        }


def _rows_to_response(
    rows: list[object],
) -> CorporateComparisonResponse | None:
    if not rows:
        return None
    first = rows[0]
    snapshot_version = str(first["snapshot_version"] or "")
    snapshot_date = str(first["snapshot_date"])
    snapshot_taken_at = str(first["snapshot_taken_at"])
    snapshot_source = str(first["snapshot_source"] or "auto_daily")
    comparison_universe = str(first["comparison_universe"] or DEFAULT_COMPARISON_UNIVERSE)
    benchmark_ticker = str(first["benchmark_ticker"] or DEFAULT_BENCHMARK_TICKER)
    custom_tickers = _normalize_custom_tickers(str(first["custom_tickers"] or "").split(","))
    risk_free_rate = float(first["risk_free_rate"] or 0.0)
    equity_risk_premium = float(first["equity_risk_premium"] or 0.0)
    stock_expected_return_method = str(first["stock_expected_return_method"] or STOCK_EXPECTED_RETURN_METHOD)
    response_rows = [
        CorporateComparisonRow(
            ticker=str(row["ticker"]),
            name=str(row["name"] or ""),
            sector=str(row["sector"] or ""),
            group_name=str(row["group_name"] or "custom"),
            weight=float(row["weight"] or 0.0),
            roic=float(row["roic"]),
            wacc=float(row["wacc"]),
            roic_minus_wacc=float(row["roic_minus_wacc"]),
            dcf_value=float(row["dcf_value"]),
            current_price=float(row["current_price"]),
            dcf_implied_return=float(row["dcf_implied_return"] or row["stock_expected_return"] or 0.0),
            capm_expected_return=float(row["capm_expected_return"] or row["market_expected_return"] or 0.0),
            stock_expected_return=float(row["stock_expected_return"]),
            market_expected_return=float(row["market_expected_return"]),
            expected_return_spread=float(row["expected_return_spread"]),
            stock_expected_return_source=str(row["stock_expected_return_source"] or STOCK_EXPECTED_RETURN_METHOD),
            has_price_data=bool(row["has_price_data"]),
            bridge_quality=str(row["bridge_quality"]),
        )
        for row in rows
    ]
    market_expected_return = float(response_rows[0].market_expected_return)
    return CorporateComparisonResponse(
        market_expected_return=market_expected_return,
        risk_free_rate=risk_free_rate,
        equity_risk_premium=equity_risk_premium,
        stock_expected_return_method=stock_expected_return_method,
        comparison_reference_return_method=REFERENCE_EXPECTED_RETURN_METHOD,
        snapshot=CorporateComparisonSnapshotMeta(
            mode="snapshot",
            as_of_date=snapshot_date,
            generated_at=snapshot_taken_at,
            snapshot_version=snapshot_version,
            snapshot_available=True,
            snapshot_source=snapshot_source,
            comparison_universe=comparison_universe,
            benchmark_ticker=benchmark_ticker,
            custom_tickers=custom_tickers,
            snapshot_cadence=SNAPSHOT_CADENCE,
            snapshot_retention_days=SNAPSHOT_RETENTION_DAYS,
            # Manual-only snapshots have no cadence to be late for: a snapshot dated before
            # today is the normal case (the user last asked then), not a missed refresh.
            snapshot_is_stale=False,
        ),
        rows=response_rows,
    )


def load_corporate_comparison_history(
    *,
    comparison_universe: str,
    benchmark_ticker: str,
    custom_tickers: list[str],
    limit: int = 30,
) -> CorporateComparisonHistoryResponse:
    normalized_benchmark = _normalize_benchmark_ticker(benchmark_ticker)
    normalized_custom_tickers = _normalize_custom_tickers(custom_tickers)
    universe_key = _comparison_universe_key(
        comparison_universe=comparison_universe,
        benchmark_ticker=normalized_benchmark,
        custom_tickers=normalized_custom_tickers,
    )
    with get_db() as conn:
        rows = conn.execute(
            """WITH versions AS (
                   SELECT snapshot_date,
                          snapshot_version,
                          snapshot_taken_at,
                          snapshot_source,
                          comparison_universe,
                          benchmark_ticker,
                          risk_free_rate,
                          equity_risk_premium,
                          ROW_NUMBER() OVER (
                              PARTITION BY snapshot_date
                              ORDER BY snapshot_taken_at DESC, snapshot_version DESC
                          ) AS version_rank
                   FROM corporate_comparison_snapshots_v3
                   WHERE universe_key = ?
               ),
               latest_versions AS (
                   SELECT *
                   FROM versions
                   WHERE version_rank = 1
               )
               SELECT lv.snapshot_date,
                      lv.snapshot_taken_at,
                      lv.snapshot_version,
                      lv.snapshot_source,
                      lv.comparison_universe,
                      lv.benchmark_ticker,
                      lv.risk_free_rate,
                      lv.equity_risk_premium,
                      AVG(CASE WHEN s.group_name != ? AND s.bridge_quality != 'missing' THEN s.expected_return_spread END) AS average_expected_return_spread,
                      AVG(CASE WHEN s.group_name != ? THEN s.roic_minus_wacc END) AS average_roic_minus_wacc,
                      AVG(CASE WHEN s.group_name != ? AND s.bridge_quality != 'missing' THEN s.dcf_value END) AS average_dcf_value,
                      COUNT(CASE WHEN s.group_name != ? THEN 1 END) AS stock_count
               FROM latest_versions lv
               JOIN corporate_comparison_snapshots_v3 s
                 ON s.snapshot_version = lv.snapshot_version
               GROUP BY lv.snapshot_date, lv.snapshot_taken_at, lv.snapshot_version,
                        lv.snapshot_source, lv.comparison_universe, lv.benchmark_ticker,
                        lv.risk_free_rate, lv.equity_risk_premium
               ORDER BY lv.snapshot_date DESC
               LIMIT ?""",
            (
                universe_key,
                BENCHMARK_GROUP_NAME,
                BENCHMARK_GROUP_NAME,
                BENCHMARK_GROUP_NAME,
                BENCHMARK_GROUP_NAME,
                limit,
            ),
        ).fetchall()
    points = [
        CorporateComparisonHistoryPoint(
            as_of_date=str(row["snapshot_date"]),
            generated_at=str(row["snapshot_taken_at"] or ""),
            snapshot_version=str(row["snapshot_version"] or ""),
            snapshot_source=str(row["snapshot_source"] or ""),
            comparison_universe=str(row["comparison_universe"] or comparison_universe),
            benchmark_ticker=str(row["benchmark_ticker"] or normalized_benchmark),
            stock_count=int(row["stock_count"] or 0),
            # NULL stays None. Both of these average only the rows whose bridge resolved,
            # so a snapshot where every non-benchmark row is 'missing' averages nothing --
            # and an average over zero rows is absent, not zero.
            average_expected_return_spread=_rounded_or_none(row["average_expected_return_spread"]),
            average_roic_minus_wacc=round(float(row["average_roic_minus_wacc"] or 0.0), 2),
            average_dcf_value=_rounded_or_none(row["average_dcf_value"]),
            market_expected_return=_market_expected_return_pct(
                float(row["risk_free_rate"] or 0.0) / 100,
                float(row["equity_risk_premium"] or 0.0) / 100,
            ),
        )
        for row in rows
    ]
    return CorporateComparisonHistoryResponse(
        comparison_universe=comparison_universe,
        benchmark_ticker=normalized_benchmark,
        custom_tickers=normalized_custom_tickers,
        points=points,
    )


def load_corporate_comparison_snapshot_version(*, snapshot_version: str) -> CorporateComparisonResponse | None:
    with get_db() as conn:
        rows = conn.execute(
            """SELECT snapshot_version, snapshot_date, snapshot_taken_at, snapshot_source, comparison_universe,
                      benchmark_ticker, custom_tickers, ticker, name, sector, group_name,
                      risk_free_rate, equity_risk_premium, stock_expected_return_method,
                      weight, roic, wacc, roic_minus_wacc, dcf_value, current_price,
                      dcf_implied_return, capm_expected_return, stock_expected_return,
                      market_expected_return, expected_return_spread, stock_expected_return_source,
                      has_price_data, bridge_quality
               FROM corporate_comparison_snapshots_v3
               WHERE snapshot_version = ?
               ORDER BY group_name, ticker""",
            (snapshot_version,),
        ).fetchall()
        if not rows:
            return None
    return _rows_to_response(rows)


def delete_corporate_comparison_snapshot_version(*, snapshot_version: str) -> int:
    with get_db() as conn:
        existing = conn.execute(
            "SELECT COUNT(*) AS row_count FROM corporate_comparison_snapshots_v3 WHERE snapshot_version = ?",
            (snapshot_version,),
        ).fetchone()
        deleted_rows = int(existing["row_count"] or 0) if existing else 0
        if deleted_rows > 0:
            conn.execute(
                "DELETE FROM corporate_comparison_snapshots_v3 WHERE snapshot_version = ?",
                (snapshot_version,),
            )
    return deleted_rows


def load_corporate_comparison_stock_history(
    *,
    ticker: str,
    comparison_universe: str,
    benchmark_ticker: str,
    custom_tickers: list[str],
    limit: int = 30,
) -> CorporateComparisonStockHistoryResponse:
    normalized_ticker = ticker.upper().strip()
    normalized_benchmark = _normalize_benchmark_ticker(benchmark_ticker)
    normalized_custom_tickers = _normalize_custom_tickers(custom_tickers)
    universe_key = _comparison_universe_key(
        comparison_universe=comparison_universe,
        benchmark_ticker=normalized_benchmark,
        custom_tickers=normalized_custom_tickers,
    )
    with get_db() as conn:
        rows = conn.execute(
            """WITH versions AS (
                   SELECT snapshot_date,
                          snapshot_version,
                          snapshot_taken_at,
                          ROW_NUMBER() OVER (
                              PARTITION BY snapshot_date
                              ORDER BY snapshot_taken_at DESC, snapshot_version DESC
                          ) AS version_rank
                   FROM corporate_comparison_snapshots_v3
                   WHERE universe_key = ?
               ),
               latest_versions AS (
                   SELECT snapshot_date, snapshot_version
                   FROM versions
                   WHERE version_rank = 1
               )
               SELECT s.snapshot_date,
                      s.snapshot_taken_at,
                      s.snapshot_version,
                      s.snapshot_source,
                      s.benchmark_ticker,
                      s.current_price,
                      s.roic_minus_wacc,
                      s.dcf_implied_return,
                      s.expected_return_spread,
                      s.market_expected_return
               FROM latest_versions lv
               JOIN corporate_comparison_snapshots_v3 s
                 ON s.snapshot_version = lv.snapshot_version
               WHERE s.ticker = ?
               ORDER BY s.snapshot_date DESC
               LIMIT ?""",
            (universe_key, normalized_ticker, limit),
        ).fetchall()
    points = [
        CorporateComparisonStockHistoryPoint(
            as_of_date=str(row["snapshot_date"]),
            generated_at=str(row["snapshot_taken_at"] or ""),
            snapshot_version=str(row["snapshot_version"] or ""),
            snapshot_source=str(row["snapshot_source"] or ""),
            benchmark_ticker=str(row["benchmark_ticker"] or normalized_benchmark),
            current_price=round(float(row["current_price"] or 0.0), 2),
            roic_minus_wacc=round(float(row["roic_minus_wacc"] or 0.0), 2),
            dcf_implied_return=round(float(row["dcf_implied_return"] or 0.0), 2),
            expected_return_spread=round(float(row["expected_return_spread"] or 0.0), 2),
            market_expected_return=round(float(row["market_expected_return"] or 0.0), 2),
        )
        for row in rows
    ]
    return CorporateComparisonStockHistoryResponse(
        ticker=normalized_ticker,
        comparison_universe=comparison_universe,
        benchmark_ticker=normalized_benchmark,
        custom_tickers=normalized_custom_tickers,
        points=points,
    )


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _now_kst() -> datetime:
    return _now_utc().astimezone(KST)


def _snapshot_business_date() -> str:
    return _now_kst().date().isoformat()


def _load_company_registry(default_companies: dict[str, dict[str, str]]) -> dict[str, dict[str, object]]:
    return load_company_universe_data(default_companies).registry


def load_company_universe_data(default_companies: dict[str, dict[str, str]]) -> CompanyUniverseData:
    registry: dict[str, dict[str, object]] = {
        ticker.upper(): {
            "ticker": ticker.upper(),
            "name": payload.get("name", ticker),
            "sector": payload.get("sector", ""),
            "group_name": "default",
            "weight": 0.0,
        }
        for ticker, payload in default_companies.items()
    }
    watchlist_payload: list[dict[str, object]] = []
    with get_db() as conn:
        watchlist_rows = conn.execute(
            """SELECT ticker, name, sector, group_name, weight
               FROM watchlist
               ORDER BY group_name, ticker"""
        ).fetchall()
        company_rows = conn.execute(
            """SELECT ticker, name, sector
               FROM corporate_companies
               ORDER BY ticker"""
        ).fetchall()

    for row in watchlist_rows:
        ticker = str(row["ticker"] or "").upper().strip()
        if not ticker:
            continue
        watchlist_payload.append(
            {
                "ticker": ticker,
                "name": row["name"] or "",
                "sector": row["sector"] or "",
                "group_name": row["group_name"] or "custom",
                "weight": float(row["weight"] or 0.0),
            }
        )
        registry[ticker] = {
            "ticker": ticker,
            "name": row["name"] or registry.get(ticker, {}).get("name") or ticker,
            "sector": row["sector"] or registry.get(ticker, {}).get("sector", ""),
            "group_name": row["group_name"] or registry.get(ticker, {}).get("group_name", "custom"),
            "weight": float(row["weight"] or 0.0),
        }

    for row in company_rows:
        ticker = str(row["ticker"] or "").upper().strip()
        if not ticker:
            continue
        existing = registry.get(ticker, {})
        registry[ticker] = {
            "ticker": ticker,
            "name": row["name"] or existing.get("name") or ticker,
            "sector": row["sector"] or existing.get("sector", ""),
            "group_name": existing.get("group_name", "manual"),
            "weight": float(existing.get("weight", 0.0)),
        }

    return CompanyUniverseData(registry=registry, watchlist_rows=watchlist_payload)


def _resolve_comparison_universe_rows(
    *,
    comparison_universe: str,
    benchmark_ticker: str,
    custom_tickers: list[str],
    company_registry: dict[str, dict[str, object]],
    watchlist_payload: list[dict[str, object]],
) -> list[dict[str, object]]:
    normalized_benchmark = _normalize_benchmark_ticker(benchmark_ticker)

    if comparison_universe == "custom":
        rows = [
            _registry_row_for_ticker(ticker, company_registry, weight=0.0)
            for ticker in _normalize_custom_tickers(custom_tickers)
        ]
        if normalized_benchmark:
            rows.append(_benchmark_row_for_ticker(normalized_benchmark, company_registry))
        return _dedupe_rows(rows)

    if comparison_universe == "portfolio_plus_benchmark":
        positive_rows = [row for row in watchlist_payload if float(row["weight"]) > 0]
        rows = positive_rows if positive_rows else _equal_weight_rows(watchlist_payload)
    else:
        rows = watchlist_payload

    if normalized_benchmark:
        rows = [*rows, _benchmark_row_for_ticker(normalized_benchmark, company_registry)]
    return _dedupe_rows(rows)


def _equal_weight_rows(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    if not rows:
        return []
    equal_weight = 1.0 / len(rows)
    return [dict(row, weight=equal_weight) for row in rows]


def _registry_row_for_ticker(
    ticker: str,
    company_registry: dict[str, dict[str, object]],
    *,
    weight: float,
) -> dict[str, object]:
    metadata = company_registry.get(ticker, {})
    return {
        "ticker": ticker,
        "name": metadata.get("name", ticker),
        "sector": metadata.get("sector", ""),
        "group_name": metadata.get("group_name", "custom"),
        "weight": weight,
    }


def _benchmark_row_for_ticker(ticker: str, company_registry: dict[str, dict[str, object]]) -> dict[str, object]:
    metadata = company_registry.get(ticker, {})
    return {
        "ticker": ticker,
        "name": metadata.get("name", ticker),
        "sector": metadata.get("sector", "Benchmark") or "Benchmark",
        "group_name": BENCHMARK_GROUP_NAME,
        "weight": 0.0,
    }


def _dedupe_rows(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    deduped: dict[str, dict[str, object]] = {}
    for row in rows:
        deduped[str(row["ticker"])] = row
    return sorted(deduped.values(), key=lambda row: (str(row["group_name"]), str(row["ticker"])))


def _normalize_benchmark_ticker(benchmark_ticker: str) -> str:
    ticker = benchmark_ticker.upper().strip()
    return ticker or DEFAULT_BENCHMARK_TICKER


def _normalize_custom_tickers(custom_tickers: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_ticker in custom_tickers:
        ticker = raw_ticker.upper().strip()
        if not ticker or ticker in seen:
            continue
        seen.add(ticker)
        normalized.append(ticker)
    return normalized


def _comparison_universe_key(
    *,
    comparison_universe: str,
    benchmark_ticker: str,
    custom_tickers: list[str],
) -> str:
    return f"{comparison_universe}|{benchmark_ticker}|{','.join(custom_tickers)}"


def _snapshot_version_id(*, universe_key: str, snapshot_taken_at: str) -> str:
    # The business-date component is gone: snapshots are manual, so there is no day for an
    # identifier to belong to. Renaming this field to snapshot_id is deferred -- the name is
    # a query parameter on two routes and an identity key across five frontend files, and
    # moving it is an API break with no behavioural gain.
    return f"{snapshot_taken_at}|{universe_key}"


def acquire_comparison_datasets(
    *,
    comparison_universe: str,
    benchmark_ticker: str,
    custom_tickers: list[str],
    company_registry: dict[str, dict[str, object]],
    watchlist_payload: list[dict[str, object]],
    now: datetime,
    statements_fetcher=fetch_statements,
    quote_facts_fetcher=fetch_quote_facts,
) -> None:
    """Refresh only the datasets whose freshness boundaries have expired, then return.

    One button, not two: separate fetch and compute buttons would let a snapshot be
    generated from statements the user forgot to refresh -- the false-precision problem
    relocated rather than solved. In the common case no acquisition occurs.

    The fetchers are injected so this is testable without a network. That is not only
    convenience: acquire_point_in_time catches Exception broadly, so the suite's network
    guard would be swallowed into a FAILED status and the test would pass while silently
    recording failures.
    """
    universe_rows = _resolve_comparison_universe_rows(
        comparison_universe=comparison_universe,
        benchmark_ticker=benchmark_ticker,
        custom_tickers=custom_tickers,
        company_registry=company_registry,
        watchlist_payload=watchlist_payload,
    )
    for row in universe_rows:
        ticker = str(row["ticker"])
        acquire_point_in_time(
            "statements", ticker, now=now,
            fetcher=statements_fetcher,
            saver=save_statements,
            coverage=statement_coverage,
        )
        acquire_point_in_time(
            "market_cap", ticker, now=now,
            fetcher=quote_facts_fetcher,
            saver=save_quote_facts,
            coverage=lambda facts: (now.date(), now.date()),
        )


def _levered_beta_from_metrics(metrics: CorporateMetrics) -> float:
    debt_to_equity = max(float(metrics.debt_ratio) / 100, 0.0)
    return max(float(metrics.unlevered_beta) * (1 + (1 - DEFAULT_TAX_RATE) * debt_to_equity), 0.0)
