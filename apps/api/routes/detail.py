"""
Detail popup routes — OHLCV, technical indicators, Monte Carlo.

GET /api/detail/{ticker}/ohlcv
GET /api/detail/{ticker}/technicals
GET /api/detail/{ticker}/monte-carlo
"""

from fastapi import APIRouter, Query
from typing import List

import numpy as np

from apps.api.models.schemas import (
    StockOHLCV, TechnicalIndicators, MonteCarloResult,
)
from apps.api.services.market_data import MarketDataService

router = APIRouter()
_mkt   = MarketDataService()


# ---------------------------------------------------------------------------
# OHLCV
# ---------------------------------------------------------------------------

@router.get("/{ticker}/ohlcv", response_model=List[StockOHLCV])
async def get_ohlcv(
    ticker: str,
    period: str = Query(default="5y"),
):
    return _mkt.get_stock_ohlcv(ticker.upper(), period=period)


@router.get("/{ticker}/technicals", response_model=TechnicalIndicators)
async def get_technicals(ticker: str, period: str = Query(default="5y")):
    """Compute RSI-14, MACD, Bollinger Bands, and MAs using the market-data service."""
    normalized_ticker = ticker.upper()
    bars = _mkt.get_stock_ohlcv(normalized_ticker, period=period)
    return _mkt._compute_technicals(normalized_ticker, bars)


# ---------------------------------------------------------------------------
# Monte Carlo — Geometric Brownian Motion (NumPy)
# Rust threshold: only if paths >= 100_000 (not yet implemented)
# ---------------------------------------------------------------------------

def _risk_label(p5: float, current: float, p95: float) -> str:
    downside_pct = abs((p5 - current) / current) * 100 if current else 0
    if downside_pct < 10:
        return "Low"
    elif downside_pct < 25:
        return "Medium"
    elif downside_pct < 40:
        return "High"
    return "Critical"


@router.get("/{ticker}/monte-carlo", response_model=MonteCarloResult)
async def get_monte_carlo(
    ticker:       str,
    paths:        int = Query(default=1000, ge=100, le=10000),
    horizon_days: int = Query(default=252, ge=30, le=756),
):
    """
    GBM Monte Carlo simulation.
    S(t+1) = S(t) × exp((μ - σ²/2)Δt + σ√Δt × Z),  Z ~ N(0,1)

    NumPy implementation. Rust will be substituted when paths ≥ 100_000.
    """
    bars = _mkt.get_stock_ohlcv(ticker.upper(), period="5y")
    if len(bars) < 30:
        return MonteCarloResult(
            ticker=ticker.upper(), paths=paths, horizon_days=horizon_days,
            p5=0, p50=0, p95=0, current=0, risk_score="Low",
        )

    closes  = np.array([b.close for b in bars], dtype=float)
    log_ret = np.diff(np.log(closes))
    mu      = log_ret.mean()
    sigma   = log_ret.std()
    current = closes[-1]
    dt      = 1.0

    # Shape: (paths, horizon_days)
    Z       = np.random.standard_normal((paths, horizon_days))
    drift   = (mu - 0.5 * sigma ** 2) * dt
    diffuse = sigma * np.sqrt(dt) * Z
    price_paths = current * np.exp(np.cumsum(drift + diffuse, axis=1))

    final = price_paths[:, -1]
    p5    = float(np.percentile(final, 5))
    p50   = float(np.percentile(final, 50))
    p95   = float(np.percentile(final, 95))

    return MonteCarloResult(
        ticker=ticker.upper(),
        paths=paths,
        horizon_days=horizon_days,
        p5=round(p5, 4),
        p50=round(p50, 4),
        p95=round(p95, 4),
        current=round(current, 4),
        risk_score=_risk_label(p5, current, p95),
        computed_by="numpy",
    )
