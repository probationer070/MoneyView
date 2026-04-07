"""Backward-compatible import path for portfolio analytics service."""

from apps.api.services.portfolio.portfolio_service import PortfolioAnalyticsService

__all__ = ["PortfolioAnalyticsService"]
