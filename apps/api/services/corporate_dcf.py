from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Callable

from apps.api.models.schemas import (
    DCFAssumptionSummary,
    DCFFullReport,
    DCFProjectionRow,
    DCFSummary,
    DCFWaccBreakdown,
    CorporateMetrics,
    ValuationAssumptions,
)

DEFAULT_EQUITY_RISK_PREMIUM = 0.055
DEFAULT_COUNTRY_RISK_PREMIUM = 0.8


def build_dcf_summary(
    ticker: str,
    params: ValuationAssumptions,
    *,
    current_price_loader: Callable[[str], float],
    metrics_loader: Callable[[str], CorporateMetrics],
    risk_free_rate: float,
    equity_risk_premium: float = DEFAULT_EQUITY_RISK_PREMIUM,
    country_risk_premium: float = DEFAULT_COUNTRY_RISK_PREMIUM,
) -> tuple[DCFSummary, DCFAssumptionSummary]:
    """Compute the lightweight DCF phases used by the realtime transport."""

    summary, assumptions, _ = _build_dcf_outputs(
        ticker=ticker,
        params=params,
        current_price_loader=current_price_loader,
        metrics_loader=metrics_loader,
        risk_free_rate=risk_free_rate,
        equity_risk_premium=equity_risk_premium,
        country_risk_premium=country_risk_premium,
    )
    return summary, assumptions


def build_dcf_full_report(
    ticker: str,
    params: ValuationAssumptions,
    *,
    current_price_loader: Callable[[str], float],
    metrics_loader: Callable[[str], CorporateMetrics],
    risk_free_rate: float,
    equity_risk_premium: float = DEFAULT_EQUITY_RISK_PREMIUM,
    country_risk_premium: float = DEFAULT_COUNTRY_RISK_PREMIUM,
) -> DCFFullReport:
    """Compute the full DCF report reserved for explicit retrieval."""

    _, _, full_report = _build_dcf_outputs(
        ticker=ticker,
        params=params,
        current_price_loader=current_price_loader,
        metrics_loader=metrics_loader,
        risk_free_rate=risk_free_rate,
        equity_risk_premium=equity_risk_premium,
        country_risk_premium=country_risk_premium,
    )
    return full_report


def _build_dcf_outputs(
    *,
    ticker: str,
    params: ValuationAssumptions,
    current_price_loader: Callable[[str], float],
    metrics_loader: Callable[[str], CorporateMetrics],
    risk_free_rate: float,
    equity_risk_premium: float,
    country_risk_premium: float,
) -> tuple[DCFSummary, DCFAssumptionSummary, DCFFullReport]:
    ticker = ticker.upper()
    current_price = current_price_loader(ticker)
    metrics = metrics_loader(ticker) if params.fcff is None or params.esg_penalty is None else None
    base_fcff = max(float(params.fcff if params.fcff is not None else metrics.fcff), 1.0)
    esg_penalty = float(params.esg_penalty if params.esg_penalty is not None else metrics.esg_penalty)
    wacc = max(float(params.wacc), 0.001)
    terminal_growth = min(float(params.terminal_growth_rate), wacc - 0.005)
    terminal_growth = max(terminal_growth, -0.1)
    margin_used = float(params.operating_margin)
    growth_used = float(params.revenue_growth_rate)
    generated_at = datetime.now(timezone.utc).isoformat()

    projection_rows: list[DCFProjectionRow] = []
    projected_fcff_values: list[float] = []
    for year in range(1, 6):
        projected_fcff = base_fcff * ((1 + growth_used) ** year)
        discount_factor = (1 + wacc) ** year
        present_value = projected_fcff / discount_factor
        projected_fcff_values.append(projected_fcff)
        projection_rows.append(
            DCFProjectionRow(
                year=year,
                projected_fcff=round(float(projected_fcff), 4),
                discount_factor=round(float(discount_factor), 6),
                present_value=round(float(present_value), 4),
            )
        )

    pv_fcff = sum(row.present_value for row in projection_rows)
    terminal_cash_flow = projected_fcff_values[-1] * (1 + terminal_growth)
    terminal_value = terminal_cash_flow / max(wacc - terminal_growth, 0.005)
    pv_terminal = terminal_value / ((1 + wacc) ** 5)
    enterprise_value = pv_fcff + pv_terminal
    agency_discount = 1 - min(max(esg_penalty, 0), 80) / 400
    dcf_multiple = enterprise_value / base_fcff
    baseline_multiple = 1 / max(wacc - terminal_growth, 0.005)
    fcff_scale = base_fcff / 92.0
    if current_price > 0:
        estimated_value = current_price * (dcf_multiple / baseline_multiple) * agency_discount * fcff_scale
    else:
        estimated_value = enterprise_value * agency_discount
    upside_pct = ((estimated_value - current_price) / current_price) * 100 if current_price > 0 else 0.0

    report_id = _report_id(
        ticker=ticker,
        growth_used=growth_used,
        margin_used=margin_used,
        wacc=wacc,
        terminal_growth=terminal_growth,
        fcff=base_fcff,
        esg_penalty=esg_penalty,
    )
    summary = DCFSummary(
        report_id=report_id,
        ticker=ticker,
        estimated_value=round(float(estimated_value), 2),
        current_price=round(float(current_price), 2),
        upside_pct=round(float(upside_pct), 2),
        status="Undervalued" if current_price > 0 and estimated_value > current_price else "Overvalued",
        generated_at=generated_at,
    )
    assumption_summary = DCFAssumptionSummary(
        report_id=report_id,
        ticker=ticker,
        generated_at=generated_at,
        wacc_used=round(float(wacc), 6),
        margin_used=round(float(margin_used), 6),
        growth_used=round(float(growth_used), 6),
        fcff_used=round(float(base_fcff), 4),
        esg_penalty_used=round(float(esg_penalty), 4),
        terminal_growth_used=round(float(terminal_growth), 6),
        enterprise_value_index=round(float(enterprise_value * agency_discount), 2),
    )
    full_report = DCFFullReport(
        summary=summary,
        assumptions=assumption_summary,
        projection_rows=projection_rows,
        wacc_breakdown=DCFWaccBreakdown(
            risk_free_rate=round(float(risk_free_rate), 6),
            unlevered_beta=round(float(params.unlevered_beta or (metrics.unlevered_beta if metrics else 0.0)), 6),
            debt_ratio=round(float(params.debt_ratio or (metrics.debt_ratio if metrics else 0.0)), 6),
            tax_rate=round(float(params.tax_rate), 6),
            equity_risk_premium=round(float(equity_risk_premium), 6),
            country_risk_premium=round(float(country_risk_premium), 6),
        ),
        terminal_cash_flow=round(float(terminal_cash_flow), 4),
        terminal_value=round(float(terminal_value), 4),
        present_value_of_terminal=round(float(pv_terminal), 4),
        present_value_of_fcff=round(float(pv_fcff), 4),
        enterprise_value=round(float(enterprise_value), 4),
        agency_discount=round(float(agency_discount), 6),
        dcf_multiple=round(float(dcf_multiple), 6),
        baseline_multiple=round(float(baseline_multiple), 6),
        fcff_scale=round(float(fcff_scale), 6),
    )
    return summary, assumption_summary, full_report


def _report_id(
    *,
    ticker: str,
    growth_used: float,
    margin_used: float,
    wacc: float,
    terminal_growth: float,
    fcff: float,
    esg_penalty: float,
) -> str:
    digest = hashlib.sha256(
        f"{ticker}|{growth_used:.8f}|{margin_used:.8f}|{wacc:.8f}|{terminal_growth:.8f}|{fcff:.8f}|{esg_penalty:.8f}".encode(
            "utf-8"
        )
    ).hexdigest()
    return digest[:16]
