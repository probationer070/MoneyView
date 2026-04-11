import json
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, List, Optional, Sequence

from .Collector import ECOSCollector, FREDCollector, GlobalMacroCollector
from .Collector.InvestpyCollector import InvestpyCollector
from .DAO import EconomicIndicator

logger = logging.getLogger(__name__)

DEFAULT_SOURCES: Sequence[str] = ("ECOS", "FRED", "Yahoo", "Investpy")
TARGETS_PATH = Path(__file__).with_name("ecos_targets.json")
LOCAL_EXPORT_ROOT = Path("src")
DEFAULT_YAHOO_CATEGORY = "글로벌 매크로"


@dataclass(frozen=True)
class FredSeriesTarget:
    series_id: str
    name: str
    category: str
    unit: str


FRED_SERIES_TARGETS: Sequence[FredSeriesTarget] = (
    FredSeriesTarget("M2SL", "미국 M2 통화량", "통화", "십억달러"),
    FredSeriesTarget("CPIAUCSL", "미국 CPI", "물가", "Index"),
    FredSeriesTarget("FEDFUNDS", "미국 기준금리", "금리", "%"),
    FredSeriesTarget("IRLTLT01JPM156N", "일본 국채 10년물", "금리", "%"),
    FredSeriesTarget("DFII10", "미국 10년물 TIPS 수익률", "금리", "%"),
    FredSeriesTarget("MYAGM2KRM189S", "한국 M2 통화량", "통화", "%"),
    FredSeriesTarget("CPALTT01KRQ657N", "한국 CPI", "물가", "Index"),
    FredSeriesTarget("KR3YT", "한국 국고채 3년물 금리", "금리", "%"),
)

YAHOO_CATEGORY_OVERRIDES = {
    "DX-Y.NYB": "환율",
    "^TNX": "금리",
    "GC=F": "자산",
    "HG=F": "자산",
    "URA": "자산",
    "BTC-USD": "자산",
}


def format_ecos_date(value: date, cycle: str) -> str:
    """Convert a Python date into the ECOS API date format."""
    if cycle == "D":
        return value.strftime("%Y%m%d")
    if cycle == "M":
        return value.strftime("%Y%m")
    if cycle == "Q":
        quarter = ((value.month - 1) // 3) + 1
        return f"{value.year}Q{quarter}"
    if cycle == "A":
        return value.strftime("%Y")
    return value.strftime("%Y%m")


def fetch_latest_data(
    ecos_api_key: Optional[str],
    fred_api_key: Optional[str],
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    sources: Optional[Sequence[str]] = None,
) -> List[EconomicIndicator]:
    """Collect the latest macro and market indicators from configured sources."""
    enabled_sources = list(sources or DEFAULT_SOURCES)
    indicators: List[EconomicIndicator] = []

    if "ECOS" in enabled_sources:
        indicators.extend(
            _fetch_ecos_data(
                ecos_api_key=ecos_api_key,
                start_date=start_date,
                end_date=end_date,
            )
        )

    if "FRED" in enabled_sources:
        indicators.extend(
            _fetch_fred_data(
                fred_api_key=fred_api_key,
                start_date=start_date,
                end_date=end_date,
            )
        )

    if "Yahoo" in enabled_sources:
        indicators.extend(
            _fetch_yahoo_data(
                start_date=start_date,
                end_date=end_date,
            )
        )

    if "Investpy" in enabled_sources:
        indicators.extend(_fetch_investpy_data())

    logger.info("Collected %d indicators from %s", len(indicators), ", ".join(enabled_sources))
    return indicators


def _fetch_ecos_data(
    ecos_api_key: Optional[str],
    start_date: Optional[date],
    end_date: Optional[date],
) -> List[EconomicIndicator]:
    if not ecos_api_key:
        logger.warning("Skipping ECOS collection because no ECOS API key was provided.")
        return []

    targets = _load_ecos_targets()
    if not targets:
        return []

    logger.info("Collecting ECOS indicators.")
    collector = _build_collector(ECOSCollector, ecos_api_key)
    indicators: List[EconomicIndicator] = []

    for target in targets:
        category = target.get("category")
        name = target.get("name")
        if _indicator_file_exists(category, name):
            continue

        cycle = target.get("cycle")
        start_value = format_ecos_date(start_date, cycle) if start_date and end_date else None
        end_value = format_ecos_date(end_date, cycle) if start_date and end_date else None

        indicators.extend(
            collector.fetch_indicator(
                target.get("stat_code"),
                target.get("item_code"),
                name,
                target.get("unit"),
                cycle,
                year=datetime.now().year,
                start_date=start_value,
                end_date=end_value,
                category=category,
            )
        )

    return indicators


def _fetch_fred_data(
    fred_api_key: Optional[str],
    start_date: Optional[date],
    end_date: Optional[date],
) -> List[EconomicIndicator]:
    if not fred_api_key:
        logger.warning("Skipping FRED collection because no FRED API key was provided.")
        return []

    logger.info("Collecting FRED indicators.")
    collector = _build_collector(FREDCollector, fred_api_key)
    indicators: List[EconomicIndicator] = []
    start_value = start_date.strftime("%Y-%m-%d") if start_date else None
    end_value = end_date.strftime("%Y-%m-%d") if end_date else None

    for target in FRED_SERIES_TARGETS:
        if _indicator_file_exists(target.category, target.name):
            continue

        indicators.extend(
            collector.fetch_indicator(
                target.series_id,
                target.name,
                target.category,
                target.unit,
                start_date=start_value,
                end_date=end_value,
            )
        )

    return indicators


def _fetch_yahoo_data(
    start_date: Optional[date],
    end_date: Optional[date],
) -> List[EconomicIndicator]:
    logger.info("Collecting Yahoo macro indicators.")
    collector = _build_collector(GlobalMacroCollector)
    start_value = start_date.strftime("%Y-%m-%d") if start_date else None
    end_value = end_date.strftime("%Y-%m-%d") if end_date else None
    indicators = collector.fetch_yahoo_data(start_date=start_value, end_date=end_value)

    for indicator in indicators:
        indicator.category = YAHOO_CATEGORY_OVERRIDES.get(indicator.code, DEFAULT_YAHOO_CATEGORY)

    return indicators


def _fetch_investpy_data() -> List[EconomicIndicator]:
    logger.info("Collecting Investpy indicators.")
    try:
        return InvestpyCollector().fetch_all()
    except Exception as exc:
        logger.exception("InvestpyCollector failed: %s", exc)
        return []


def _load_ecos_targets() -> List[dict]:
    try:
        with TARGETS_PATH.open("r", encoding="utf-8") as file:
            return json.load(file)
    except FileNotFoundError:
        logger.error("ecos_targets.json was not found at %s", TARGETS_PATH)
    except json.JSONDecodeError:
        logger.error("ecos_targets.json is not valid JSON: %s", TARGETS_PATH)
    return []


def _indicator_file_exists(category: Optional[str], name: Optional[str]) -> bool:
    if not category or not name:
        return False

    category_slug = _sanitize_path_part(category)
    name_slug = _sanitize_path_part(name)
    return (LOCAL_EXPORT_ROOT / category_slug / f"{name_slug}.csv").exists()


def _sanitize_path_part(value: str) -> str:
    sanitized = str(value).replace(" ", "_").replace("/", "_")
    return re.sub(r'[\\*?:"<>|()]', "", sanitized)


def _build_collector(collector_ref: Any, *args):
    try:
        return collector_ref(*args)
    except TypeError:
        return getattr(collector_ref, collector_ref.__name__)(*args)
