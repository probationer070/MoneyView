"""
Detail popup routes — OHLCV, technical indicators, Monte Carlo.

GET /api/detail/{ticker}/ohlcv
GET /api/detail/{ticker}/technicals
GET /api/detail/{ticker}/monte-carlo
"""

from fastapi import APIRouter, Query
from typing import List, Optional

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
    period: str = Query(default="1y"),
):
    return _mkt.get_stock_ohlcv(ticker.upper(), period=period)


# ---------------------------------------------------------------------------
# Technical Indicators (pure NumPy)
# ---------------------------------------------------------------------------

def _rsi(closes: np.ndarray, period: int = 14) -> Optional[float]:
    if len(closes) < period + 1:
        return None
    delta = np.diff(closes)
    gain  = np.where(delta > 0, delta, 0.0)
    loss  = np.where(delta < 0, -delta, 0.0)
    avg_gain = gain[-period:].mean()
    avg_loss = loss[-period:].mean()
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def _ema(closes: np.ndarray, span: int) -> np.ndarray:
    alpha  = 2.0 / (span + 1)
    result = np.empty_like(closes, dtype=float)
    result[0] = closes[0]
    for i in range(1, len(closes)):
        result[i] = alpha * closes[i] + (1 - alpha) * result[i - 1]
    return result


def _macd(closes: np.ndarray):
    if len(closes) < 26:
        return None, None, None
    ema12   = _ema(closes, 12)
    ema26   = _ema(closes, 26)
    line    = ema12 - ema26
    signal  = _ema(line, 9)
    hist    = line - signal
    return round(float(line[-1]), 4), round(float(signal[-1]), 4), round(float(hist[-1]), 4)


def _bollinger(closes: np.ndarray, period: int = 20):
    if len(closes) < period:
        return None, None, None
    window = closes[-period:]
    mid    = window.mean()
    std    = window.std()
    return round(float(mid + 2*std), 4), round(float(mid), 4), round(float(mid - 2*std), 4)


def _sma(closes: np.ndarray, period: int) -> Optional[float]:
    if len(closes) < period:
        return None
    return round(float(closes[-period:].mean()), 4)


@router.get("/{ticker}/technicals", response_model=TechnicalIndicators)
async def get_technicals(ticker: str, period: str = Query(default="1y")):
    """Compute RSI-14, MACD, Bollinger Bands, and MAs using pure NumPy."""
    bars = _mkt.get_stock_ohlcv(ticker.upper(), period=period)
    if not bars:
        return TechnicalIndicators(ticker=ticker.upper())

    closes = np.array([b.close for b in bars], dtype=float)
    macd, macd_sig, macd_hist = _macd(closes)
    bb_upper, bb_mid, bb_lower = _bollinger(closes)

    return TechnicalIndicators(
        ticker=ticker.upper(),
        rsi_14=_rsi(closes),
        macd=macd,
        macd_signal=macd_sig,
        macd_hist=macd_hist,
        bb_upper=bb_upper,
        bb_mid=bb_mid,
        bb_lower=bb_lower,
        ma_20=_sma(closes, 20),
        ma_50=_sma(closes, 50),
        ma_200=_sma(closes, 200),
        as_of_date=bars[-1].date if bars else None,
    )


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
    bars = _mkt.get_stock_ohlcv(ticker.upper(), period="2y")
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
