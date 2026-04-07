try:
    from . import RegulationCrawler
except ModuleNotFoundError:
    RegulationCrawler = None

try:
    from . import YoutubeCrawler
except ModuleNotFoundError:
    YoutubeCrawler = None
from . import StockNewsCrawler

__all__ = [
    "RegulationCrawler",
    "StockNewsCrawler",
    "YoutubeCrawler",
]
