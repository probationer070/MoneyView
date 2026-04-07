"""
Corporate analysis routes.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Body

from apps.api.models.schemas import APIResponse, APIMeta, CorporateCompany, CorporateMetrics, ValuationAssumptions
from apps.api.services.db import get_db
from apps.api.services.market_data import MarketDataService

router = APIRouter()
_API_ROOT = Path(__file__).resolve().parents[1]
_WATCHLIST_JSON = _API_ROOT / "services" / "webscrap" / "stock_targets.json"
_mkt = MarketDataService()

DEFAULT_METRICS = {
    "AAPL": {"growth": 6, "roic": 18, "wacc": 10, "debt_ratio": 18, "unlevered_beta": 1.05},
    "MSFT": {"growth": 7, "roic": 22, "wacc": 9, "debt_ratio": 15, "unlevered_beta": 0.95},
    "NVDA": {"growth": 16, "roic": 32, "wacc": 12, "debt_ratio": 10, "unlevered_beta": 1.55},
    "TSLA": {"growth": 12, "roic": 13, "wacc": 13, "debt_ratio": 22, "unlevered_beta": 1.7},
    "AMZN": {"growth": 9, "roic": 12, "wacc": 10.5, "debt_ratio": 24, "unlevered_beta": 1.15},
    "GOOGL": {"growth": 8, "roic": 20, "wacc": 9.5, "debt_ratio": 8, "unlevered_beta": 1.0},
    "META": {"growth": 10, "roic": 24, "wacc": 10.25, "debt_ratio": 12, "unlevered_beta": 1.2},
    "NFLX": {"growth": 8, "roic": 16, "wacc": 11, "debt_ratio": 26, "unlevered_beta": 1.25},
    "AMD": {"growth": 11, "roic": 11, "wacc": 12, "debt_ratio": 18, "unlevered_beta": 1.45},
    "AVGO": {"growth": 8, "roic": 21, "wacc": 10.75, "debt_ratio": 35, "unlevered_beta": 1.1},
    "JPM": {"growth": 4, "roic": 10, "wacc": 8.75, "debt_ratio": 42, "unlevered_beta": 0.9},
    "V": {"growth": 7, "roic": 28, "wacc": 8.5, "debt_ratio": 16, "unlevered_beta": 0.85},
    "UNH": {"growth": 6, "roic": 15, "wacc": 8.75, "debt_ratio": 28, "unlevered_beta": 0.8},
    "XOM": {"growth": 3, "roic": 12, "wacc": 9.25, "debt_ratio": 20, "unlevered_beta": 0.95},
    "LEU": {"growth": 14, "roic": 14, "wacc": 14, "debt_ratio": 30, "unlevered_beta": 1.8},
}

DEFAULT_COMPANIES = {
    "AAPL": {"name": "Apple", "sector": "Technology"},
    "MSFT": {"name": "Microsoft", "sector": "Technology"},
    "NVDA": {"name": "Nvidia", "sector": "Semiconductors"},
    "TSLA": {"name": "Tesla", "sector": "Automotive"},
    "AMZN": {"name": "Amazon", "sector": "Consumer Discretionary"},
    "GOOGL": {"name": "Alphabet", "sector": "Communication Services"},
    "META": {"name": "Meta Platforms", "sector": "Communication Services"},
    "NFLX": {"name": "Netflix", "sector": "Communication Services"},
    "AMD": {"name": "AMD", "sector": "Semiconductors"},
    "AVGO": {"name": "Broadcom", "sector": "Semiconductors"},
    "JPM": {"name": "JPMorgan Chase", "sector": "Financials"},
    "V": {"name": "Visa", "sector": "Financials"},
    "UNH": {"name": "UnitedHealth", "sector": "Health Care"},
    "XOM": {"name": "Exxon Mobil", "sector": "Energy"},
    "LEU": {"name": "Centrus Energy", "sector": "Energy"},
}


def _default_metrics(ticker: str) -> CorporateMetrics:
    ticker = ticker.upper()
    if ticker in DEFAULT_METRICS:
        return CorporateMetrics(ticker=ticker, **DEFAULT_METRICS[ticker])

    sector = ""
    try:
        with get_db() as conn:
            row = conn.execute(
                """SELECT sector FROM watchlist WHERE ticker = ?
                   UNION ALL
                   SELECT sector FROM corporate_companies WHERE ticker = ?
                   LIMIT 1""",
                (ticker, ticker),
            ).fetchone()
            if row:
                sector = row["sector"] or ""
    except Exception:
        sector = ""

    seed = sum(ord(char) for char in f"{ticker}:{sector}")
    sector_lower = sector.lower()

    growth = 5.0 + (seed % 9)
    roic = 10.0 + (seed % 18)
    wacc = 8.0 + (seed % 18) * 0.25
    debt_ratio = 12.0 + (seed % 36)
    unlevered_beta = 0.8 + (seed % 13) * 0.07

    if any(term in sector_lower for term in ("semiconductor", "software", "cloud", "ai", "technology")):
        growth += 2.0
        roic += 3.0
        unlevered_beta += 0.15
    elif any(term in sector_lower for term in ("energy", "oil", "gas", "nuclear")):
        growth -= 1.5
        debt_ratio += 5.0
        wacc += 0.5
    elif any(term in sector_lower for term in ("financial", "bank", "insurance")):
        roic -= 2.0
        debt_ratio += 10.0
        unlevered_beta -= 0.05
    elif any(term in sector_lower for term in ("utility", "water", "electric")):
        growth -= 2.0
        debt_ratio += 14.0
        unlevered_beta -= 0.15

    return CorporateMetrics(
        ticker=ticker,
        growth=round(max(growth, 1.0), 2),
        roic=round(max(roic, 5.0), 2),
        wacc=round(max(wacc, 6.0), 2),
        debt_ratio=round(min(max(debt_ratio, 5.0), 70.0), 2),
        unlevered_beta=round(min(max(unlevered_beta, 0.55), 2.4), 2),
        crp=round(0.6 + (seed % 12) * 0.1, 2),
        reinvestment=round(24.0 + (seed % 36), 2),
        fcff=round(45.0 + (seed % 140), 2),
        innovation=round(48.0 + (seed % 45), 2),
        market_share=round(28.0 + (seed % 52), 2),
        governance=round(52.0 + (seed % 38), 2),
        esg_penalty=round(8.0 + (seed % 32), 2),
    )


def _is_generic_default(row) -> bool:
    return (
        float(row["growth"]) == 6.0
        and float(row["roic"]) == 18.0
        and float(row["wacc"]) == 10.0
        and float(row["debt_ratio"]) == 18.0
        and float(row["unlevered_beta"]) == 1.05
        and float(row["crp"]) == 1.1
        and float(row["reinvestment"]) == 34.0
        and float(row["fcff"]) == 92.0
        and float(row["innovation"]) == 82.0
        and float(row["market_share"]) == 64.0
        and float(row["governance"]) == 74.0
        and float(row["esg_penalty"]) == 22.0
    )


def _metrics_for_ticker(ticker: str) -> CorporateMetrics:
    ticker = ticker.upper()
    with get_db() as conn:
        row = conn.execute(
            """SELECT * FROM corporate_metrics WHERE ticker = ?""",
            (ticker,),
        ).fetchone()
    if not row:
        return _default_metrics(ticker)
    if _is_generic_default(row):
        preset = DEFAULT_METRICS.get(ticker)
        if ticker not in DEFAULT_METRICS or any(
            float(preset.get(key, row[key])) != float(row[key])
            for key in ("growth", "roic", "wacc", "debt_ratio", "unlevered_beta")
        ):
            return _default_metrics(ticker)
    return CorporateMetrics(
        ticker=row["ticker"],
        growth=row["growth"],
        roic=row["roic"],
        wacc=row["wacc"],
        debt_ratio=row["debt_ratio"],
        unlevered_beta=row["unlevered_beta"],
        crp=row["crp"],
        reinvestment=row["reinvestment"],
        fcff=row["fcff"],
        innovation=row["innovation"],
        market_share=row["market_share"],
        governance=row["governance"],
        esg_penalty=row["esg_penalty"],
    )


def _latest_market_price(ticker: str) -> float:
    bars = _mkt.get_stock_ohlcv(ticker, period="1mo")
    if not bars:
        return 0.0
    return float(bars[-1].close)


def _seed_watchlist_from_json_if_empty() -> None:
    """Populate watchlist-backed companies without requiring Portfolio tab first."""
    if not _WATCHLIST_JSON.exists():
        return

    with get_db() as conn:
        existing = conn.execute("""SELECT COUNT(*) AS count FROM watchlist""").fetchone()
        if existing and int(existing["count"]) > 0:
            return

        try:
            data = json.loads(_WATCHLIST_JSON.read_text(encoding="utf-8"))
        except Exception:
            return

        for group_name, group in data.items():
            for target in group.get("targets", []):
                ticker = str(target.get("ticker", "")).upper().strip()
                if not ticker:
                    continue
                conn.execute(
                    """INSERT OR IGNORE INTO watchlist (ticker, name, sector, group_name)
                       VALUES (?, ?, ?, ?)""",
                    (
                        ticker,
                        target.get("name", ticker),
                        target.get("sector", ""),
                        group_name,
                    ),
                )


@router.get("/companies", response_model=list[CorporateCompany])
async def get_corporate_companies():
    """Return company-name-first corporate analysis universe."""
    _seed_watchlist_from_json_if_empty()
    companies: dict[str, CorporateCompany] = {
        ticker: CorporateCompany(
            ticker=ticker,
            name=payload["name"],
            sector=payload["sector"],
            source="default",
        )
        for ticker, payload in DEFAULT_COMPANIES.items()
    }

    with get_db() as conn:
        watchlist_rows = conn.execute(
            """SELECT ticker, name, sector FROM watchlist ORDER BY name, ticker"""
        ).fetchall()
        manual_rows = conn.execute(
            """SELECT ticker, name, sector, source FROM corporate_companies ORDER BY name, ticker"""
        ).fetchall()

    for row in watchlist_rows:
        ticker = str(row["ticker"]).upper()
        name = row["name"] or DEFAULT_COMPANIES.get(ticker, {}).get("name") or ticker
        companies[ticker] = CorporateCompany(
            ticker=ticker,
            name=name,
            sector=row["sector"] or DEFAULT_COMPANIES.get(ticker, {}).get("sector", ""),
            source="portfolio",
        )

    for row in manual_rows:
        ticker = str(row["ticker"]).upper()
        companies[ticker] = CorporateCompany(
            ticker=ticker,
            name=row["name"] or ticker,
            sector=row["sector"] or DEFAULT_COMPANIES.get(ticker, {}).get("sector", ""),
            source=row["source"] or "manual",
        )

    return sorted(companies.values(), key=lambda company: company.name.lower())


@router.post("/companies", response_model=CorporateCompany)
async def add_corporate_company(company: CorporateCompany = Body(...)):
    """Persist a manually added company for on-demand corporate analysis."""
    payload = company.model_copy(
        update={
            "ticker": company.ticker.upper().strip(),
            "name": company.name.strip(),
            "sector": company.sector.strip(),
            "source": company.source or "manual",
        }
    )
    with get_db() as conn:
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """INSERT OR REPLACE INTO corporate_companies
               (ticker, name, sector, source, updated_at)
               VALUES (?, ?, ?, ?, ?)""",
            (payload.ticker, payload.name or payload.ticker, payload.sector, payload.source, now),
        )
    default_metrics = _default_metrics(payload.ticker)
    with get_db() as conn:
        conn.execute(
            """INSERT OR IGNORE INTO corporate_metrics
               (ticker, growth, roic, wacc, debt_ratio, unlevered_beta, crp,
                reinvestment, fcff, innovation, market_share, governance,
                esg_penalty, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                payload.ticker,
                default_metrics.growth,
                default_metrics.roic,
                default_metrics.wacc,
                default_metrics.debt_ratio,
                default_metrics.unlevered_beta,
                default_metrics.crp,
                default_metrics.reinvestment,
                default_metrics.fcff,
                default_metrics.innovation,
                default_metrics.market_share,
                default_metrics.governance,
                default_metrics.esg_penalty,
                now,
            ),
        )
    return payload


@router.post("/dcf/{ticker}")
async def dynamic_dcf_model(ticker: str, params: ValuationAssumptions):
    """
    Ticker-aware DCF recalculation bound to the Next.js Debouncer.
    """
    ticker = ticker.upper()
    metrics = _metrics_for_ticker(ticker)
    current_price = _latest_market_price(ticker)
    base_fcff = max(float(params.fcff if params.fcff is not None else metrics.fcff), 1.0)
    esg_penalty = params.esg_penalty if params.esg_penalty is not None else metrics.esg_penalty
    wacc = max(params.wacc, 0.001)
    terminal_growth = min(params.terminal_growth_rate, wacc - 0.005)
    terminal_growth = max(terminal_growth, -0.1)

    projected_fcff = [
        base_fcff * ((1 + params.revenue_growth_rate) ** year)
        for year in range(1, 6)
    ]
    pv_fcff = sum(
        cash_flow / ((1 + wacc) ** year)
        for year, cash_flow in enumerate(projected_fcff, start=1)
    )
    terminal_cash_flow = projected_fcff[-1] * (1 + terminal_growth)
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

    return APIResponse(
        status="ok",
        data={
            "estimated_value": round(estimated_value, 2),
            "current_price": round(current_price, 2),
            "upside_pct": round(upside_pct, 2),
            "wacc_used": params.wacc,
            "margin_used": params.operating_margin,
            "growth_used": params.revenue_growth_rate,
            "fcff_used": base_fcff,
            "esg_penalty_used": esg_penalty,
            "terminal_growth_used": terminal_growth,
            "enterprise_value_index": round(enterprise_value * agency_discount, 2),
            "status": "Undervalued" if current_price > 0 and estimated_value > current_price else "Overvalued",
        },
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )


@router.get("/metrics/{ticker}", response_model=CorporateMetrics)
async def get_corporate_metrics(ticker: str):
    ticker = ticker.upper()
    return _metrics_for_ticker(ticker)


@router.put("/metrics/{ticker}", response_model=CorporateMetrics)
async def save_corporate_metrics(ticker: str, metrics: CorporateMetrics):
    ticker = ticker.upper()
    payload = metrics.model_copy(update={"ticker": ticker})
    with get_db() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO corporate_metrics
               (ticker, growth, roic, wacc, debt_ratio, unlevered_beta, crp,
                reinvestment, fcff, innovation, market_share, governance,
                esg_penalty, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                ticker,
                payload.growth,
                payload.roic,
                payload.wacc,
                payload.debt_ratio,
                payload.unlevered_beta,
                payload.crp,
                payload.reinvestment,
                payload.fcff,
                payload.innovation,
                payload.market_share,
                payload.governance,
                payload.esg_penalty,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
    return payload


@router.get("/diagnostic/{ticker}/radar")
async def get_corporate_radar(ticker: str):
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
async def get_monte_carlo_tornado(ticker: str):
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
