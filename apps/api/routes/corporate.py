"""
Corporate analysis routes.
"""

import json
import time
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Body, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

from packages.core_finance.refusals import EngineRefusal

from apps.api.core.dev_monitor import perf_timer
from apps.api.core.logger import setup_logger
from apps.api.core.transport_progress import log_transport_phase
from apps.api.models.schemas import (
    APIResponse,
    APIMeta,
    BulkDcfReports,
    DCFFullReport,
    CorporateComparisonSnapshotDeleteResult,
    CorporateCompany,
    CorporateDerivedMetricMeta,
    CorporateComparisonHistoryResponse,
    CorporateComparisonResponse,
    CorporateComparisonStockHistoryResponse,
    CorporateDcfBatchRequest,
    CorporateMetricAudit,
    CorporateMetrics,
    ValuationAssumptions,
)
from apps.api.services import corporate_metrics_service
from apps.api.services.records_sync import service as records_sync
from apps.api.services.corporate_comparison import (
    DEFAULT_BENCHMARK_TICKER,
    DEFAULT_COMPARISON_UNIVERSE,
    DEFAULT_SNAPSHOT_MODE,
    acquire_comparison_datasets,
    build_corporate_comparison_response,
    delete_corporate_comparison_snapshot_version,
    load_company_universe_data,
    load_corporate_comparison_history,
    load_corporate_comparison_snapshot_version,
    load_corporate_comparison_stock_history,
    save_corporate_comparison_snapshot,
)
from apps.api.services.corporate_dcf import (
    build_bulk_dcf_reports,
    build_dcf_full_report,
    build_dcf_summary,
    partition_valuable_tickers,
)
from apps.api.services.db import get_db
from apps.api.services.market_assumptions import Assumptions, AssumptionsMissing, AssumptionsRefused, resolve_assumptions
from apps.api.models.schema_parts.corporate import AssumptionsOut, WaccRefusal
from apps.api.services.corporate_statement_metrics import (
    YAHOO_STATEMENT_START_YEAR,
    get_yahoo_statement_bundle,
    metric_audit_for_ticker,
    statement_currency_mismatch,
)

router = APIRouter()
logger = setup_logger(__name__)
_WATCHLIST_JSON = corporate_metrics_service.WATCHLIST_JSON
DEFAULT_COMPANIES = corporate_metrics_service.DEFAULT_COMPANIES


def _sse_event(event: str, payload: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"


def _default_metrics(ticker: str) -> CorporateMetrics:
    return corporate_metrics_service.default_metrics(ticker)


def _is_generic_default(row) -> bool:
    return corporate_metrics_service.is_generic_default(row)


def _load_fallback_metrics(ticker: str) -> tuple[CorporateMetrics, bool]:
    return corporate_metrics_service.load_fallback_metrics(ticker)


def _get_yahoo_statement_bundle(ticker: str, endpoint: str) -> Optional[dict[str, object]]:
    return get_yahoo_statement_bundle(ticker, endpoint)


def _resolve_assumptions_now() -> Assumptions | AssumptionsMissing:
    with get_db() as conn:
        return resolve_assumptions(conn, datetime.now(timezone.utc))


def _fractions_or_refuse() -> Assumptions:
    """The resolver result for builders that take fractions; a refusal becomes the `assumptions_missing` payload."""
    resolved = _resolve_assumptions_now()
    if isinstance(resolved, AssumptionsMissing):
        raise AssumptionsRefused(resolved.missing)
    return resolved


def assumptions_refused_response(_request: Request, exc: AssumptionsRefused) -> JSONResponse:
    """HTTP 200 with no number: never a silent default (plan 2026-11-16 section 2)."""
    refusal = {"code": exc.code, "missing": list(exc.missing)}
    return JSONResponse(status_code=200, content={"status": "unavailable", "reason": exc.code, "wacc_refusal": refusal})


def _metrics_for_ticker(
    ticker: str,
    growth_basis: str = "cagr",
    roic_basis: str = "recent_average",
    growth_year: Optional[int] = None,
    roic_year: Optional[int] = None,
    assumptions: Optional[Assumptions | AssumptionsMissing] = None,
) -> CorporateMetrics:
    with perf_timer(scope="calculation", operation="ticker.metrics", ticker=ticker) as span_metadata:
        metrics = corporate_metrics_service.metrics_for_ticker(
            ticker,
            growth_basis=growth_basis,
            roic_basis=roic_basis,
            growth_year=growth_year,
            roic_year=roic_year,
            bundle_loader=_get_yahoo_statement_bundle,
            assumptions=assumptions,
        )
        span_metadata["rows"] = 1
        return metrics


def _latest_market_price(ticker: str) -> float:
    with perf_timer(scope="calculation", operation="ticker.price", ticker=ticker) as span_metadata:
        price = corporate_metrics_service.latest_market_price(ticker)
        span_metadata["cache_state"] = "n/a"
        return price


def _seed_watchlist_from_json_if_empty() -> None:
    """Populate watchlist-backed companies without requiring Portfolio tab first."""
    corporate_metrics_service.seed_watchlist_from_json_if_empty(_WATCHLIST_JSON)


def _metric_percent_for_valuation(
    metric_name: str,
    value: float,
    meta: CorporateDerivedMetricMeta | None,
    *,
    minimum: float,
    maximum: float,
) -> float:
    return corporate_metrics_service.metric_percent_for_valuation(
        metric_name,
        value,
        meta,
        minimum=minimum,
        maximum=maximum,
    )


def _valuation_params_from_metrics(metrics: CorporateMetrics) -> ValuationAssumptions:
    return corporate_metrics_service.valuation_params_from_metrics(metrics)


@router.get("/companies", response_model=list[CorporateCompany])
def get_corporate_companies():
    """Return company-name-first corporate analysis universe."""
    return corporate_metrics_service.list_companies(_WATCHLIST_JSON)


@router.post("/companies", response_model=CorporateCompany)
def add_corporate_company(company: CorporateCompany = Body(...)):
    """Persist a manually added company for on-demand corporate analysis."""
    saved = corporate_metrics_service.add_company(company)
    records_sync.run_records_sync("mutation")
    return saved


@router.get("/comparison", response_model=APIResponse[CorporateComparisonResponse])
def get_corporate_comparison(
    mode: Literal["snapshot", "live"] = Query(default=DEFAULT_SNAPSHOT_MODE),
    comparison_universe: Literal["portfolio_plus_benchmark", "watchlist_plus_benchmark", "custom"] = Query(
        default=DEFAULT_COMPARISON_UNIVERSE
    ),
    benchmark_ticker: str = Query(default=DEFAULT_BENCHMARK_TICKER),
    custom_tickers: str = Query(default=""),
):
    """Return cross-stock comparison rows for the current target-stock universe."""
    _seed_watchlist_from_json_if_empty()
    assumptions = _fractions_or_refuse()
    response = build_corporate_comparison_response(
        mode=mode,
        comparison_universe=comparison_universe,
        benchmark_ticker=benchmark_ticker,
        custom_tickers=[ticker for ticker in custom_tickers.split(",") if ticker.strip()],
        metrics_loader=_metrics_for_ticker,
        price_loader=_latest_market_price,
        default_companies=DEFAULT_COMPANIES,
        risk_free_rate=assumptions.rf_fraction,
        equity_risk_premium=assumptions.erp_fraction,
    )
    return APIResponse(
        data=response,
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )


@router.post("/comparison/snapshot", response_model=APIResponse[CorporateComparisonResponse])
def refresh_corporate_comparison_snapshot(
    comparison_universe: Literal["portfolio_plus_benchmark", "watchlist_plus_benchmark", "custom"] = Query(
        default=DEFAULT_COMPARISON_UNIVERSE
    ),
    benchmark_ticker: str = Query(default=DEFAULT_BENCHMARK_TICKER),
    custom_tickers: str = Query(default=""),
):
    """Recompute and persist today's comparison snapshot."""
    _seed_watchlist_from_json_if_empty()
    parsed_custom_tickers = [ticker for ticker in custom_tickers.split(",") if ticker.strip()]
    assumptions = _fractions_or_refuse()

    # One button: refresh only the datasets whose freshness boundaries have expired, then
    # compute. Separate fetch and compute buttons would let a snapshot be generated from
    # statements the user forgot to refresh.
    company_data = load_company_universe_data(DEFAULT_COMPANIES)
    acquire_comparison_datasets(
        comparison_universe=comparison_universe,
        benchmark_ticker=benchmark_ticker,
        custom_tickers=parsed_custom_tickers,
        company_registry=company_data.registry,
        watchlist_payload=company_data.watchlist_rows,
        now=datetime.now(timezone.utc),
    )

    response = save_corporate_comparison_snapshot(
        snapshot_source="manual_refresh",
        comparison_universe=comparison_universe,
        benchmark_ticker=benchmark_ticker,
        custom_tickers=parsed_custom_tickers,
        metrics_loader=_metrics_for_ticker,
        price_loader=_latest_market_price,
        default_companies=DEFAULT_COMPANIES,
        risk_free_rate=assumptions.rf_fraction,
        equity_risk_premium=assumptions.erp_fraction,
    )
    return APIResponse(
        data=response,
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )


@router.get("/comparison/history", response_model=APIResponse[CorporateComparisonHistoryResponse])
def get_corporate_comparison_history(
    comparison_universe: Literal["portfolio_plus_benchmark", "watchlist_plus_benchmark", "custom"] = Query(
        default=DEFAULT_COMPARISON_UNIVERSE
    ),
    benchmark_ticker: str = Query(default=DEFAULT_BENCHMARK_TICKER),
    custom_tickers: str = Query(default=""),
    limit: int = Query(default=30, ge=1, le=365),
):
    """Return persisted snapshot-history summaries for the selected comparison universe."""
    _seed_watchlist_from_json_if_empty()
    response = load_corporate_comparison_history(
        comparison_universe=comparison_universe,
        benchmark_ticker=benchmark_ticker,
        custom_tickers=[ticker for ticker in custom_tickers.split(",") if ticker.strip()],
        limit=limit,
    )
    return APIResponse(
        data=response,
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )


@router.get("/comparison/snapshot-version", response_model=APIResponse[CorporateComparisonResponse])
def get_corporate_comparison_snapshot_version(snapshot_version: str = Query(..., min_length=1)):
    """Return one persisted comparison snapshot version by id."""
    normalized_snapshot_version = snapshot_version.strip().replace(" ", "+")
    response = load_corporate_comparison_snapshot_version(snapshot_version=normalized_snapshot_version)
    if response is None:
        raise HTTPException(status_code=404, detail="Snapshot version not found")
    return APIResponse(
        data=response,
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )


@router.delete("/comparison/snapshot-version", response_model=APIResponse[CorporateComparisonSnapshotDeleteResult])
def delete_corporate_comparison_snapshot(snapshot_version: str = Query(..., min_length=1)):
    """Delete one persisted comparison snapshot version by id."""
    normalized_snapshot_version = snapshot_version.strip().replace(" ", "+")
    deleted_rows = delete_corporate_comparison_snapshot_version(snapshot_version=normalized_snapshot_version)
    if deleted_rows == 0:
        raise HTTPException(status_code=404, detail="Snapshot version not found")
    return APIResponse(
        data=CorporateComparisonSnapshotDeleteResult(
            snapshot_version=normalized_snapshot_version,
            deleted_rows=deleted_rows,
        ),
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )


@router.get("/comparison/stock-history", response_model=APIResponse[CorporateComparisonStockHistoryResponse])
def get_corporate_comparison_stock_history(
    ticker: str = Query(..., min_length=1),
    comparison_universe: Literal["portfolio_plus_benchmark", "watchlist_plus_benchmark", "custom"] = Query(
        default=DEFAULT_COMPARISON_UNIVERSE
    ),
    benchmark_ticker: str = Query(default=DEFAULT_BENCHMARK_TICKER),
    custom_tickers: str = Query(default=""),
    limit: int = Query(default=30, ge=1, le=365),
):
    """Return per-stock saved snapshot metrics across the selected snapshot timeline."""
    _seed_watchlist_from_json_if_empty()
    response = load_corporate_comparison_stock_history(
        ticker=ticker,
        comparison_universe=comparison_universe,
        benchmark_ticker=benchmark_ticker,
        custom_tickers=[raw_ticker for raw_ticker in custom_tickers.split(",") if raw_ticker.strip()],
        limit=limit,
    )
    return APIResponse(
        data=response,
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )


def _refusal_422(exc: EngineRefusal) -> HTTPException:
    """A DCF the model declines to produce is content for the caller, not a 500."""
    return HTTPException(status_code=422, detail={"code": exc.code, "message": str(exc)})


@router.post("/dcf/{ticker}")
def dynamic_dcf_model(ticker: str, params: ValuationAssumptions):
    """
    Lightweight non-streaming DCF summary response kept for compatibility paths.
    """
    assumptions = _fractions_or_refuse()
    try:
        summary, assumption_summary = build_dcf_summary(
            ticker=ticker,
            params=params,
            current_price_loader=_latest_market_price,
            metrics_loader=_metrics_for_ticker,
            risk_free_rate=assumptions.rf_fraction,
            equity_risk_premium=assumptions.erp_fraction,
            currency_check=statement_currency_mismatch,
        )
    except EngineRefusal as exc:
        raise _refusal_422(exc) from exc
    return APIResponse(
        status="ok",
        data={**summary.model_dump(), **assumption_summary.model_dump(exclude={"report_id", "ticker", "generated_at"})},
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )


@router.post("/dcf/{ticker}/report", response_model=APIResponse[DCFFullReport])
def get_dcf_full_report(ticker: str, params: ValuationAssumptions):
    """Return the full DCF report only on explicit request."""
    assumptions = _fractions_or_refuse()
    try:
        report = build_dcf_full_report(
            ticker=ticker,
            params=params,
            current_price_loader=_latest_market_price,
            metrics_loader=_metrics_for_ticker,
            risk_free_rate=assumptions.rf_fraction,
            equity_risk_premium=assumptions.erp_fraction,
            currency_check=statement_currency_mismatch,
        )
    except EngineRefusal as exc:
        raise _refusal_422(exc) from exc
    return APIResponse(
        status="ok",
        data=report,
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )


@router.post("/dcf/reports/bulk", response_model=APIResponse[BulkDcfReports])
def get_bulk_dcf_reports(request: CorporateDcfBatchRequest):
    """Calculate full DCF reports for a list of comparison tickers."""
    # Refuse what a DCF cannot value before spending a report on it. The watchlist carries
    # gold and silver ETFs, which have no cash flows of their own; a number produced for
    # one is meaningless rather than imprecise.
    with get_db() as conn:
        instrument_types = {
            str(row["ticker"]): str(row["instrument_type"] or "")
            for row in conn.execute(
                "SELECT ticker, instrument_type FROM corporate_quote_facts"
            )
        }
    valuable, not_companies = partition_valuable_tickers(request.tickers, instrument_types)
    assumptions = _fractions_or_refuse()

    result = build_bulk_dcf_reports(
        valuable,
        current_price_loader=_latest_market_price,
        metrics_loader=_metrics_for_ticker,
        valuation_params_builder=_valuation_params_from_metrics,
        report_builder=build_dcf_full_report,
        risk_free_rate=assumptions.rf_fraction,
        equity_risk_premium=assumptions.erp_fraction,
        currency_check=statement_currency_mismatch,
    )
    # `skipped` travels with the reports rather than being logged and dropped. A batch
    # that returned 134 reports for 139 tickers with nothing naming the other five would
    # be a completeness the response has not earned.
    return APIResponse(
        status="ok",
        data=BulkDcfReports(reports=result.reports, skipped=not_companies + result.skipped),
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )


@router.post("/dcf/{ticker}/stream")
async def stream_dcf_summary(request: Request, ticker: str, params: ValuationAssumptions = Body(...)):
    """Stream the phase 1 and phase 2 DCF payloads without shipping the full report."""
    # Computed before the stream opens: a refusal raised inside the generator would arrive
    # after the 200 headers, as a stream that dies. Here it is a 422 the client can read.
    started_at = time.perf_counter()
    assumptions = _fractions_or_refuse()
    try:
        summary, assumption_summary = build_dcf_summary(
            ticker=ticker,
            params=params,
            current_price_loader=_latest_market_price,
            metrics_loader=_metrics_for_ticker,
            risk_free_rate=assumptions.rf_fraction,
            equity_risk_premium=assumptions.erp_fraction,
            currency_check=statement_currency_mismatch,
        )
    except EngineRefusal as exc:
        raise _refusal_422(exc) from exc

    async def event_stream():
        request_id = getattr(request.state, "request_id", "")
        bytes_sent = 0
        chunk_count = 0
        phase1_event = _sse_event("phase1", {"phase": "phase1", "summary": summary.model_dump()})
        bytes_sent += len(phase1_event.encode("utf-8"))
        chunk_count += 1
        log_transport_phase(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            phase="phase1",
            elapsed_ms=(time.perf_counter() - started_at) * 1000,
            bytes_sent=bytes_sent,
            chunk_count=chunk_count,
        )
        yield phase1_event
        phase2_event = _sse_event("phase2", {"phase": "phase2", "assumptions": assumption_summary.model_dump()})
        bytes_sent += len(phase2_event.encode("utf-8"))
        chunk_count += 1
        log_transport_phase(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            phase="phase2",
            elapsed_ms=(time.perf_counter() - started_at) * 1000,
            bytes_sent=bytes_sent,
            chunk_count=chunk_count,
        )
        yield phase2_event
        complete_event = _sse_event(
            "complete",
            {
                "phase": "complete",
                "report_id": summary.report_id,
                "generated_at": summary.generated_at,
            },
        )
        bytes_sent += len(complete_event.encode("utf-8"))
        chunk_count += 1
        log_transport_phase(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            phase="complete",
            elapsed_ms=(time.perf_counter() - started_at) * 1000,
            bytes_sent=bytes_sent,
            chunk_count=chunk_count,
            completed=True,
        )
        yield complete_event

    return StreamingResponse(event_stream(), media_type="text/event-stream")


def _with_assumptions_echo(metrics: CorporateMetrics, resolved: Assumptions | AssumptionsMissing) -> CorporateMetrics:
    """Report the market assumptions the metrics were built with; refused means no WACC and no Ke."""
    if isinstance(resolved, AssumptionsMissing):
        return metrics.model_copy(update={
            "wacc": None,
            "cost_of_equity": None,
            "wacc_refusal": WaccRefusal(code=resolved.code, missing=list(resolved.missing)),
        })
    mature = metrics.crp == 0
    echo = AssumptionsOut(
        risk_free_rate=resolved.risk_free_rate,
        risk_free_source=resolved.risk_free_source,
        risk_free_as_of=resolved.risk_free_as_of,
        equity_risk_premium=resolved.equity_risk_premium,
        erp_source=resolved.erp_source,
        erp_as_of=resolved.erp_as_of,
        crp=0.0 if mature else resolved.crp_non_mature,
        crp_basis="mature_market_rule" if mature else "non_mature_rule",
        stale=list(resolved.stale),
    )
    return metrics.model_copy(update={"assumptions": echo})


@router.get("/metrics/{ticker}", response_model=CorporateMetrics)
def get_corporate_metrics(
    ticker: str,
    growth_basis: Literal["cagr", "recent_average", "annual"] = Query(default="cagr"),
    roic_basis: Literal["recent_average", "all_year_average", "annual"] = Query(default="recent_average"),
    growth_year: Optional[int] = Query(default=None, ge=YAHOO_STATEMENT_START_YEAR),
    roic_year: Optional[int] = Query(default=None, ge=YAHOO_STATEMENT_START_YEAR),
):
    ticker = ticker.upper()
    logger.info(
        "corporate.metrics_request ticker=%s growth_basis=%s growth_year=%s roic_basis=%s roic_year=%s",
        ticker,
        growth_basis,
        growth_year,
        roic_basis,
        roic_year,
    )
    resolved = _resolve_assumptions_now()
    metrics = _metrics_for_ticker(
        ticker,
        growth_basis=growth_basis,
        roic_basis=roic_basis,
        growth_year=growth_year,
        roic_year=roic_year,
        assumptions=resolved,
    )
    return _with_assumptions_echo(metrics, resolved)


@router.get("/metrics/{ticker}/audit", response_model=CorporateMetricAudit)
def get_corporate_metric_audit(
    ticker: str,
    roic_basis: Literal["recent_average", "all_year_average", "annual"] = Query(default="recent_average"),
    roic_year: Optional[int] = Query(default=None, ge=YAHOO_STATEMENT_START_YEAR),
):
    ticker = ticker.upper()
    logger.info(
        "corporate.metric_audit_request ticker=%s roic_basis=%s roic_year=%s",
        ticker,
        roic_basis,
        roic_year,
    )
    fallback, has_saved_metrics = _load_fallback_metrics(ticker)
    return metric_audit_for_ticker(
        ticker,
        fallback,
        has_saved_metrics=has_saved_metrics,
        roic_basis=roic_basis,
        roic_year=roic_year,
        bundle_loader=_get_yahoo_statement_bundle,
    )


@router.get("/metrics/{ticker}/history")
def get_corporate_metric_history(ticker: str):
    ticker = ticker.upper()
    logger.info("corporate.metrics_history_request ticker=%s", ticker)
    return corporate_metrics_service.metric_history(
        ticker, bundle_loader=_get_yahoo_statement_bundle, assumptions=_resolve_assumptions_now()
    )


@router.get("/metrics/{ticker}/quarterly-statements")
def get_corporate_quarterly_statements(ticker: str):
    ticker = ticker.upper()
    logger.info("corporate.quarterly_statements_request ticker=%s", ticker)
    return corporate_metrics_service.quarterly_statement_payload(ticker, bundle_loader=_get_yahoo_statement_bundle)


@router.put("/metrics/{ticker}", response_model=CorporateMetrics)
def save_corporate_metrics(ticker: str, metrics: CorporateMetrics):
    if metrics.wacc is None:
        raise HTTPException(status_code=422, detail={"code": "wacc_unavailable", "message": "a refused WACC cannot be saved"})
    saved = corporate_metrics_service.save_metrics(ticker, metrics)
    records_sync.run_records_sync("mutation")
    return saved


@router.get("/diagnostic/{ticker}/radar")
def get_corporate_radar(ticker: str):
    """
    Native Recharts Radar mappings resolving overlapping qualitative bounds.
    Requires: [{subject: string, score: number, peer: number, max: number}]
    """
    return APIResponse(
        data=[
            {"subject": "Scale", "score": 85, "peer": 70, "max": 100},
            {"subject": "Growth", "score": 45, "peer": 60, "max": 100},
            {"subject": "Profitability", "score": 92, "peer": 65, "max": 100},
            {"subject": "Risk", "score": 55, "peer": 50, "max": 100},
            {"subject": "Valuation", "score": 30, "peer": 60, "max": 100},
        ]
    )


@router.get("/diagnostic/{ticker}/tornado")
def get_monte_carlo_tornado(ticker: str):
    """
    Native Recharts Bar mapping for Monte Carlo sensitivity.
    Requires: [{name: string, target: number}]
    """
    return APIResponse(
        data=[
            {"name": "Bear (5%)", "target": 75.50},
            {"name": "Base (50%)", "target": 115.00},
            {"name": "Bull (95%)", "target": 145.20},
        ]
    )
