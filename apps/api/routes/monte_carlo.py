"""
Monte Carlo investment analysis routes.
"""

from __future__ import annotations

import math
import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel, Field

from apps.api.core.dev_monitor import perf_timer

router = APIRouter()


class MonteCarloRequest(BaseModel):
    ticker: str = "AAPL"
    current_price: float = Field(default=190.0, gt=0)
    horizon_years: float = Field(default=1.0, gt=0, le=10)
    steps_per_year: int = Field(default=252, ge=12, le=252)
    path_count: int = Field(default=800, ge=100, le=5000)
    expected_return: float = Field(default=0.09, ge=-1, le=2)
    volatility: float = Field(default=0.28, gt=0, le=2)
    risk_free_rate: float = Field(default=0.04, ge=-0.1, le=0.25)
    jump_probability: float = Field(default=0.03, ge=0, le=1)
    jump_probability_monthly: float | None = Field(default=None, ge=0, le=1)
    jump_intensity: float = Field(default=-0.18, ge=-1, le=1)
    jump_intensity_multiplier: float | None = Field(default=None, ge=0, le=10)
    jump_volatility: float = Field(default=0.08, ge=0, le=1)
    valuation_growth: float = Field(default=0.06, ge=-0.5, le=0.5)
    valuation_growth_sigma: float = Field(default=0.03, ge=0, le=0.5)
    valuation_wacc: float = Field(default=0.095, gt=0, le=0.6)
    valuation_wacc_sigma: float = Field(default=0.015, ge=0, le=0.3)
    base_fcff: float = Field(default=9.0, gt=0)
    terminal_growth: float = Field(default=0.025, ge=-0.1, le=0.1)
    seed: int = Field(default=42, ge=0)


class MonteCarloResponse(BaseModel):
    ticker: str
    model: str
    path_summary: list[dict[str, float]]
    sample_paths: list[dict[str, float]]
    risk_metrics: dict[str, float]
    histogram: list[dict[str, float]]
    normal_fit: list[dict[str, float]]
    cdf_comparison: list[dict[str, float]]
    valuation: dict[str, float]
    valuation_distribution: list[dict[str, float]]
    correlation: dict[str, object]


def _normal_pdf(x: float, mean: float, std: float) -> float:
    if std <= 0:
        return 0.0
    z = (x - mean) / std
    return math.exp(-0.5 * z * z) / (std * math.sqrt(2 * math.pi))


def _normal_cdf(x: float, mean: float, std: float) -> float:
    if std <= 0:
        return 0.0
    return 0.5 * (1 + math.erf((x - mean) / (std * math.sqrt(2))))


def _percentile(records: np.ndarray, pct: float) -> float:
    return float(np.percentile(records, pct))


def _path_summary(paths: np.ndarray, horizon_years: float) -> list[dict[str, float]]:
    steps = paths.shape[1] - 1
    points: list[dict[str, float]] = []
    stride = max(1, steps // 80)
    for index in range(0, steps + 1, stride):
        column = paths[:, index]
        points.append({
            "time": round(index / steps * horizon_years, 4),
            "mean": round(float(column.mean()), 4),
            "p05": round(_percentile(column, 5), 4),
            "p10": round(_percentile(column, 10), 4),
            "p25": round(_percentile(column, 25), 4),
            "p50": round(_percentile(column, 50), 4),
            "p75": round(_percentile(column, 75), 4),
            "p90": round(_percentile(column, 90), 4),
            "p95": round(_percentile(column, 95), 4),
        })
    if points[-1]["time"] != horizon_years:
        column = paths[:, -1]
        points.append({
            "time": round(horizon_years, 4),
            "mean": round(float(column.mean()), 4),
            "p05": round(_percentile(column, 5), 4),
            "p10": round(_percentile(column, 10), 4),
            "p25": round(_percentile(column, 25), 4),
            "p50": round(_percentile(column, 50), 4),
            "p75": round(_percentile(column, 75), 4),
            "p90": round(_percentile(column, 90), 4),
            "p95": round(_percentile(column, 95), 4),
        })
    return points


def _sample_paths(paths: np.ndarray, horizon_years: float, count: int = 20) -> list[dict[str, float]]:
    steps = paths.shape[1] - 1
    stride = max(1, steps // 80)
    selected = paths[: min(count, paths.shape[0])]
    rows: list[dict[str, float]] = []
    for index in range(0, steps + 1, stride):
        row = {"time": round(index / steps * horizon_years, 4)}
        for path_index, values in enumerate(selected):
            row[f"path_{path_index + 1}"] = round(float(values[index]), 4)
        rows.append(row)
    return rows


def _histogram(values: np.ndarray, bins: int = 32) -> list[dict[str, float]]:
    counts, edges = np.histogram(values, bins=bins)
    total = max(int(values.size), 1)
    rows: list[dict[str, float]] = []
    for index, count in enumerate(counts):
        left = float(edges[index])
        right = float(edges[index + 1])
        midpoint = (left + right) / 2
        rows.append({
            "return": round(midpoint * 100, 4),
            "frequency": round(float(count) / total, 6),
            "count": int(count),
            "loss_bucket": 1 if midpoint < 0 else 0,
        })
    return rows


def _cdf_comparison(values: np.ndarray, mean: float, std: float) -> list[dict[str, float]]:
    quantiles = np.linspace(1, 99, 50)
    sorted_values = np.sort(values)
    rows: list[dict[str, float]] = []
    for quantile in quantiles:
        simulated = float(np.percentile(sorted_values, quantile))
        rows.append({
            "return": round(simulated * 100, 4),
            "simulated_cdf": round(float(quantile / 100), 4),
            "normal_cdf": round(_normal_cdf(simulated, mean, std), 4),
        })
    return rows


def _normal_fit_rows(values: np.ndarray, mean: float, std: float) -> list[dict[str, float]]:
    low, high = float(np.percentile(values, 1)), float(np.percentile(values, 99))
    xs = np.linspace(low, high, 80)
    return [{"return": round(float(x) * 100, 4), "density": round(_normal_pdf(float(x), mean, std), 6)} for x in xs]


def _risk_metrics(returns: np.ndarray, risk_free_rate: float, horizon_years: float) -> dict[str, float]:
    losses = -returns
    var95 = _percentile(losses, 95)
    var99 = _percentile(losses, 99)
    cvar95 = float(losses[losses >= var95].mean()) if np.any(losses >= var95) else var95
    cvar99 = float(losses[losses >= var99].mean()) if np.any(losses >= var99) else var99
    downside = returns[returns < 0]
    downside_deviation = float(np.sqrt(np.mean(np.square(downside)))) if downside.size else 0.0
    excess_return = float(returns.mean() - risk_free_rate * horizon_years)
    sortino = excess_return / downside_deviation if downside_deviation > 0 else 0.0
    std = float(returns.std(ddof=1)) if returns.size > 1 else 0.0
    skewness = float(np.mean(((returns - returns.mean()) / std) ** 3)) if std > 0 else 0.0
    excess_kurtosis = float(np.mean(((returns - returns.mean()) / std) ** 4) - 3) if std > 0 else 0.0
    annualized_return = ((1 + float(returns.mean())) ** (1 / horizon_years) - 1) if horizon_years > 0 and returns.mean() > -1 else float(returns.mean())
    annualized_volatility = std / math.sqrt(horizon_years) if horizon_years > 0 else std
    sharpe = (annualized_return - risk_free_rate) / annualized_volatility if annualized_volatility > 0 else 0.0
    return {
        "mean_return": round(float(returns.mean()) * 100, 4),
        "median_return": round(_percentile(returns, 50) * 100, 4),
        "volatility": round(std * 100, 4),
        "annualized_return": round(annualized_return * 100, 4),
        "annualized_volatility": round(annualized_volatility * 100, 4),
        "sharpe_ratio": round(sharpe, 4),
        "var95": round(var95 * 100, 4),
        "var99": round(var99 * 100, 4),
        "cvar95": round(cvar95 * 100, 4),
        "cvar99": round(cvar99 * 100, 4),
        "sortino_ratio": round(sortino, 4),
        "skewness": round(skewness, 4),
        "excess_kurtosis": round(excess_kurtosis, 4),
        "loss_probability": round(float(np.mean(returns < 0)) * 100, 4),
    }


def _valuation_distribution(request: MonteCarloRequest, rng: np.random.Generator, sample_count: int) -> tuple[np.ndarray, dict[str, float]]:
    growth = rng.normal(request.valuation_growth, request.valuation_growth_sigma, sample_count)
    wacc = rng.normal(request.valuation_wacc, request.valuation_wacc_sigma, sample_count)
    terminal_growth = np.minimum(request.terminal_growth, wacc - 0.005)
    terminal_growth = np.maximum(terminal_growth, -0.05)
    fair_values = np.zeros(sample_count)
    for year in range(1, 6):
        cash_flow = request.base_fcff * np.power(1 + growth, year)
        fair_values += cash_flow / np.power(1 + wacc, year)
    terminal_cash_flow = request.base_fcff * np.power(1 + growth, 5) * (1 + terminal_growth)
    terminal_value = terminal_cash_flow / np.maximum(wacc - terminal_growth, 0.005)
    fair_values += terminal_value / np.power(1 + wacc, 5)
    mean = float(fair_values.mean())
    std = float(fair_values.std(ddof=1))
    undervaluation_probability = float(np.mean(fair_values > request.current_price))
    z_score = (mean - request.current_price) / std if std > 0 else 0.0
    summary = {
        "fair_value_mean": round(mean, 4),
        "fair_value_median": round(_percentile(fair_values, 50), 4),
        "fair_value_p05": round(_percentile(fair_values, 5), 4),
        "fair_value_p95": round(_percentile(fair_values, 95), 4),
        "undervaluation_probability": round(undervaluation_probability * 100, 4),
        "p_value_overvalued": round((1 - undervaluation_probability) * 100, 4),
        "z_score": round(z_score, 4),
    }
    return fair_values, summary


def _correlation_model(rng: np.random.Generator, sample_count: int) -> dict[str, object]:
    assets = ["Equity", "Quality", "Growth", "Rates", "Credit"]
    expected = np.array([0.09, 0.075, 0.12, 0.035, 0.055])
    volatility = np.array([0.18, 0.13, 0.28, 0.08, 0.11])
    corr = np.array([
        [1.00, 0.72, 0.64, -0.18, 0.42],
        [0.72, 1.00, 0.51, -0.12, 0.36],
        [0.64, 0.51, 1.00, -0.24, 0.48],
        [-0.18, -0.12, -0.24, 1.00, 0.21],
        [0.42, 0.36, 0.48, 0.21, 1.00],
    ])
    cholesky = np.linalg.cholesky(corr)
    random_normals = rng.standard_normal((sample_count, len(assets)))
    correlated = random_normals @ cholesky.T
    asset_returns = expected + correlated * volatility
    heatmap = [
        {"asset_x": assets[i], "asset_y": assets[j], "correlation": round(float(corr[i, j]), 4)}
        for i in range(len(assets))
        for j in range(len(assets))
    ]
    frontier: list[dict[str, float]] = []
    for _ in range(180):
        weights = rng.dirichlet(np.ones(len(assets)))
        portfolio_returns = asset_returns @ weights
        frontier.append({
            "return": round(float(portfolio_returns.mean()) * 100, 4),
            "risk": round(float(portfolio_returns.std(ddof=1)) * 100, 4),
            "sharpe": round(float((portfolio_returns.mean() - 0.04) / portfolio_returns.std(ddof=1)), 4),
        })
    sensitivity = []
    for rho in np.linspace(-0.2, 0.9, 12):
        synthetic_corr = np.full((len(assets), len(assets)), rho)
        np.fill_diagonal(synthetic_corr, 1.0)
        covariance = np.outer(volatility, volatility) * synthetic_corr
        weights = np.full(len(assets), 1 / len(assets))
        portfolio_variance = max(float(weights @ covariance @ weights), 0.0)
        portfolio_vol = math.sqrt(portfolio_variance)
        sensitivity.append({"spearman_rho": round(float(rho), 4), "portfolio_volatility": round(portfolio_vol * 100, 4)})
    return {
        "assets": assets,
        "heatmap": heatmap,
        "efficient_frontier": sorted(frontier, key=lambda row: row["risk"]),
        "spearman_sensitivity": sensitivity,
        "cholesky_first_row": [round(float(value), 4) for value in cholesky[0]],
    }


@router.post("/analyze", response_model=MonteCarloResponse)
async def analyze_monte_carlo(request: MonteCarloRequest):
    with perf_timer(scope="calculation", operation="calculation.monte_carlo_backend", ticker=request.ticker.upper(), component="monte_carlo", metadata={"path_count": request.path_count, "steps_per_year": request.steps_per_year, "seed": request.seed}):
        rng = np.random.default_rng(request.seed)
        steps = max(1, int(request.horizon_years * request.steps_per_year))
        dt = request.horizon_years / steps
        jump_lambda = request.jump_probability / request.horizon_years
        if request.jump_probability_monthly is not None:
            jump_lambda = -12 * math.log(max(1 - request.jump_probability_monthly, 1e-9))
        jump_mean = request.jump_intensity
        if request.jump_intensity_multiplier is not None:
            jump_mean = -request.volatility * request.jump_intensity_multiplier
        paths = np.empty((request.path_count, steps + 1))
        paths[:, 0] = request.current_price
        drift = (request.expected_return - 0.5 * request.volatility ** 2) * dt
        diffusion_scale = request.volatility * math.sqrt(dt)
        for step in range(1, steps + 1):
            shocks = rng.standard_normal(request.path_count)
            jump_occurs = rng.random(request.path_count) < jump_lambda * dt
            jumps = np.where(
                jump_occurs,
                rng.normal(jump_mean, request.jump_volatility, request.path_count),
                0.0,
            )
            paths[:, step] = paths[:, step - 1] * np.exp(drift + diffusion_scale * shocks + jumps)

        terminal_returns = paths[:, -1] / request.current_price - 1
        mean = float(terminal_returns.mean())
        std = float(terminal_returns.std(ddof=1))
        fair_values, valuation_summary = _valuation_distribution(request, rng, request.path_count)
        with perf_timer(scope="metric", operation="metric.volatility_var_cvar", ticker=request.ticker.upper(), component="monte_carlo"):
            risk_metrics = _risk_metrics(terminal_returns, request.risk_free_rate, request.horizon_years)
        return MonteCarloResponse(
            ticker=request.ticker.upper(),
            model="GBM + Jump-Diffusion with DCF valuation sampling and Cholesky correlation model",
            path_summary=_path_summary(paths, request.horizon_years),
            sample_paths=_sample_paths(paths, request.horizon_years),
            risk_metrics=risk_metrics,
            histogram=_histogram(terminal_returns),
            normal_fit=_normal_fit_rows(terminal_returns, mean, std),
            cdf_comparison=_cdf_comparison(terminal_returns, mean, std),
            valuation=valuation_summary,
            valuation_distribution=_histogram(fair_values / request.current_price - 1),
            correlation=_correlation_model(rng, request.path_count),
        )
