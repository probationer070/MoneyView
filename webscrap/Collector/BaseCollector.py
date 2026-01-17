from abc import ABC, abstractmethod
from typing import List
from WebScrap.DAO import EconomicIndicator

class BaseCollector(ABC):
    """
    모든 데이터 수집기의 추상 기본 클래스 (Abstract Base Class)
    """
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "API_BASE_URL"

    @abstractmethod
    def fetch_indicator(self, *args, **kwargs) -> List[EconomicIndicator]:
        """
        지표 데이터를 수집하여 반환합니다.
        하위 클래스에서 구체적인 로직을 구현해야 합니다.
        
        Returns:
            List[EconomicIndicator]: 수집된 지표 데이터 리스트
        """
        pass