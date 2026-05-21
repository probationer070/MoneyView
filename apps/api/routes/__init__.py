from .market import router as market_router
from .portfolio import router as portfolio_router
from .detail import router as detail_router
from .news import router as news_router
from .corporate import router as corporate_router
from .diagnostic import router as diagnostic_router
from .dev_monitor import router as dev_monitor_router
from .report import router as report_router
from .monte_carlo import router as monte_carlo_router
from .stock import router as stock_router

__all__ = [
    "market_router", "portfolio_router",
    "detail_router", "news_router", "corporate_router", "diagnostic_router", "dev_monitor_router", "report_router", "monte_carlo_router", "stock_router",
]
