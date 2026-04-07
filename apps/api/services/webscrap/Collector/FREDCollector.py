from typing import List, Optional, Dict
from ..DAO import EconomicIndicator
from ..Collector.BaseCollector import BaseCollector
import requests
import logging

logger = logging.getLogger(__name__)

class FREDCollector(BaseCollector):
    """
    FRED (Federal Reserve Economic Data) 데이터 수집기
    """
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.stlouisfed.org/fred/series/observations"

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
