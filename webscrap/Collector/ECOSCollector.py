import requests
import logging

from typing import List, Optional, Dict
from datetime import datetime, timedelta
from WebScrap.DAO import EconomicIndicator
from WebScrap.Collector.BaseCollector import BaseCollector

logger = logging.getLogger(__name__)

class ECOSCollector(BaseCollector):
    """
    1. 한국 내부 요인: 한국은행 경제통계시스템 (ECOS) 수집기
    """
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "http://ecos.bok.or.kr/api/StatisticSearch"

    def fetch_indicator(self, stat_code: str, item_code: str, name: str, unit: str, cycle: str = "M", year: Optional[int] = None, start_date: Optional[str] = None, end_date: Optional[str] = None) -> List[EconomicIndicator]:
        """ECOS API를 호출하여 최신 지표 하나를 가져옵니다."""
        # URL 포맷: /인증키/json/kr/1/1/통계표코드/주기/검색시작일자/검색종료일자/항목코드
        # 편의상 최근 데이터 1건만 조회하도록 설정
        # 날짜 동적 설정 (최근 2년 데이터 조회하여 최신값 확보)
        # now = datetime.now()
        
        if start_date and end_date:
            s_date = start_date
            e_date = end_date
        elif cycle == "D":
            # 일별 데이터 1년치 조회 (페이징 제한 고려하여 1000건 요청)
            s_date = (datetime.now() - timedelta(days=365)).strftime("%Y%m%d")
            e_date = datetime.now().strftime("%Y%m%d")
        elif cycle == "A":
            s_date = f"{year - 1}"
            e_date = f"{year}"
        elif cycle == "Q":
            s_date = f"{year - 1}Q1"
            e_date = f"{year}Q4"
        else: # Default M (Monthly)
            s_date = f"{year - 1}01"
            e_date = f"{year}12"
            
        url = f"{self.base_url}/{self.api_key}/json/kr/1/1000/{stat_code}/{cycle}/{s_date}/{e_date}/{item_code}"
        
        try:
            response = requests.get(url)
            data = response.json()
            
            results = []
            if 'StatisticSearch' in data and 'row' in data['StatisticSearch']:
                for row in data['StatisticSearch']['row']:
                    results.append(EconomicIndicator(
                        category="한국 내부 요인",
                        name=name,
                        code=item_code,
                        value=float(row['DATA_VALUE']),
                        unit=unit,
                        date=row['TIME'],
                        source="ECOS"
                    ))
                return results
            else:
                logger.warning(f"ECOS 데이터 없음: {name} ({item_code}) URL: {url}")
                return []
        except Exception as e:
            logger.error(f"ECOS API 오류 ({name}): {e}")
            return []
