from typing import List, Optional, Dict, Tuple
from ..DAO import EconomicIndicator
from ..Collector.BaseCollector import BaseCollector
import math
import requests
import logging

logger = logging.getLogger(__name__)

class FredFetchError(Exception):
    """A FRED request failed. The message never contains the API key."""


def parse_observations(payload: dict) -> List[Tuple[str, float]]:
    """FRED marks a missing day with '.'; it is dropped, not read as zero.

    Non-finite values ('nan', 'inf', '-inf') are skipped like '.', so they never reach
    the engine as numbers. An empty 'observations' list returns []. A payload that is
    not a dict with an 'observations' list, an observation without 'value' or 'date',
    or a non-numeric value raises FredFetchError("malformed response").
    """
    rows = []
    malformed = False
    try:
        observations = payload["observations"]
        if not isinstance(observations, list):
            malformed = True
        else:
            for o in observations:
                value = o["value"]
                if value == ".":
                    continue
                number = float(value)
                if math.isfinite(number):
                    rows.append((o["date"], number))
    except (KeyError, TypeError, ValueError):
        malformed = True
    if malformed:
        raise FredFetchError("malformed response")
    return sorted(rows)


class FREDCollector(BaseCollector):
    """
    FRED (Federal Reserve Economic Data) 데이터 수집기
    """
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.stlouisfed.org/fred/series/observations"

    def fetch_observations(self, series_id: str, start_date: str, timeout: float = 15.0) -> List[Tuple[str, float]]:
        """Raising variant for the signal engine: a failure must be told apart from no data.

        `from None` drops the requests exception, whose message carries the full URL and
        therefore the api_key query parameter.
        """
        params = {"series_id": series_id, "api_key": self.api_key, "file_type": "json",
                  "sort_order": "asc", "observation_start": start_date}
        failed = None
        try:
            response = requests.get(self.base_url, params=params, timeout=timeout)
        except requests.RequestException as exc:
            failed = type(exc).__name__
        if failed is not None:
            # Raised outside the except block so no __context__ holds the requests exception.
            raise FredFetchError(f"{series_id}: {failed}") from None
        if response.status_code != 200:
            detail = response.text[:200].replace(self.api_key, "***")
            raise FredFetchError(f"{series_id}: HTTP {response.status_code} {detail}")
        try:
            body = response.json()
        except ValueError:
            body = None
        try:
            return parse_observations(body)
        except FredFetchError:
            pass
        raise FredFetchError(f"{series_id}: malformed response")

    def fetch_indicator(self, series_id: str, name: str, category: str, unit: str = "", start_date: Optional[str] = None, end_date: Optional[str] = None) -> List[EconomicIndicator]:
        params = {
            "series_id": series_id,
            "api_key": self.api_key,
            "file_type": "json",
            "sort_order": "desc"
        }
        if start_date:
            params["observation_start"] = start_date
        if end_date:
            params["observation_end"] = end_date
            
        try:
            response = requests.get(self.base_url, params=params)
            data = response.json()
            
            results = []
            if "observations" in data:
                for obs in data["observations"]:
                    val = obs['value']
                    if val == ".": continue
                    
                    results.append(EconomicIndicator(
                        category=category,
                        name=name,
                        code=series_id,
                        value=float(val),
                        unit=unit,
                        date=obs['date'],
                        source="FRED"
                    ))
            return results
        except Exception as e:
            logger.error(f"FRED API 오류 ({name}): {e}")
            return []
