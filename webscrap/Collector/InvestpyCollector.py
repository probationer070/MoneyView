import requests
from bs4 import BeautifulSoup
from typing import List, Optional
import logging
from ..DAO.Economic import EconomicIndicator
from datetime import datetime, timedelta
import json

try:
    from investiny import historical_data, search_assets
    HAS_INVESTINY = True
except ImportError:
    HAS_INVESTINY = False

logger = logging.getLogger(__name__)

# South Korea 5Y CDS의 Investing.com ID
# search_assets(query="south korea cds")로 검색하여 확인 가능
SOUTH_KOREA_CDS_5Y_ID = 1159098


class InvestpyCollector:
    """
    Investing.com에서 데이터를 크롤링하는 수집기.
    investiny 라이브러리를 사용하며, 실패 시 worldgovernmentbonds.com을 fallback으로 사용.
    주요 목표: 한국 5년물 CDS 프리미엄 등 Yahoo/FRED에서 제공하지 않는 데이터 수집.
    """
    def __init__(self):
        self.targets = {
            "CDS_KR_5Y": {
                "name": "한국 5년물 CDS 프리미엄",
                "category": "대외건전성",
                "unit": "bp",
                "investing_id": SOUTH_KOREA_CDS_5Y_ID,
                # fallback URL
                "fallback_url": "http://www.worldgovernmentbonds.com/cds-historical-data/south-korea/5-years/"
            }
        }

    def _fetch_cds_via_investiny(self, start_date: str, end_date: str) -> List[EconomicIndicator]:
        """investiny로 CDS 시계열 데이터 수집. 날짜 형식: YYYY-MM-DD"""
        if not HAS_INVESTINY:
            logger.warning("investiny가 설치되지 않았습니다. pip install investiny 로 설치하세요.")
            return []

        target = self.targets["CDS_KR_5Y"]
        results = []

        try:
            # investiny는 MM/DD/YYYY 형식을 사용
            from_dt = datetime.strptime(start_date, "%Y-%m-%d")
            to_dt = datetime.strptime(end_date, "%Y-%m-%d")
            from_str = from_dt.strftime("%m/%d/%Y")
            to_str = to_dt.strftime("%m/%d/%Y")

            data = historical_data(
                investing_id=target["investing_id"],
                from_date=from_str,
                to_date=to_str
            )

            if not data or "close" not in data:
                logger.warning("investiny에서 CDS 데이터를 가져왔지만 비어 있습니다.")
                return []

            # data = {"open": [...], "high": [...], "low": [...], "close": [...], "volume": [...]}
            # 날짜 정보는 별도로 계산 필요 (investiny는 날짜를 반환하지 않음)
            # 대신 date_from ~ date_to 범위의 영업일 기준으로 매핑
            close_values = data["close"]

            # investiny는 날짜를 반환하지 않으므로, 날짜를 역산
            # 데이터 개수 기반으로 날짜 범위 생성 (영업일 기준 근사)
            total_days = (to_dt - from_dt).days
            if len(close_values) > 0:
                day_step = max(1, total_days // len(close_values))
            else:
                return []

            for i, val in enumerate(close_values):
                if val is None:
                    continue
                approx_date = from_dt + timedelta(days=i * day_step)
                results.append(EconomicIndicator(
                    category=target["category"],
                    name=target["name"],
                    code="CDS_KR_5Y",
                    value=float(val),
                    unit=target["unit"],
                    date=approx_date.strftime('%Y-%m-%d'),
                    source="Investing.com (investiny)"
                ))

            logger.info(f"investiny로 CDS 데이터 {len(results)}건 수집 완료")

        except Exception as e:
            logger.error(f"investiny CDS 수집 실패: {e}")

        return results

    def _fetch_cds_via_scraping(self) -> List[EconomicIndicator]:
        """worldgovernmentbonds.com 스크래핑으로 최신 CDS 값 수집 (fallback)"""
        results = []
        target = self.targets["CDS_KR_5Y"]
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
        }

        try:
            response = requests.get(target["fallback_url"], headers=headers, timeout=10)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')

            cds_val_str = soup.select_one('div.box-valor')

            if cds_val_str:
                val_text = cds_val_str.text.strip().replace('bp', '').strip()
                try:
                    current_val = float(val_text)
                    results.append(EconomicIndicator(
                        category=target["category"],
                        name=target["name"],
                        code="CDS_KR_5Y",
                        value=current_val,
                        unit=target["unit"],
                        date=datetime.now().strftime('%Y-%m-%d'),
                        source="WorldGovernmentBonds"
                    ))
                    logger.info(f"[Fallback] CDS 프리미엄 수집: {current_val} bp")
                except ValueError:
                    logger.warning("CDS 파싱 실패")
            else:
                logger.warning("CDS 프리미엄 데이터 요소를 찾을 수 없습니다.")
        except Exception as e:
            logger.error(f"CDS 프리미엄 스크래핑 실패: {e}")

        return results

    def fetch_cds_premium(self, start_date=None, end_date=None) -> List[EconomicIndicator]:
        """CDS 프리미엄 수집. investiny 우선, 실패 시 스크래핑 fallback."""
        if start_date and end_date:
            results = self._fetch_cds_via_investiny(start_date, end_date)
            if results:
                return results

        # investiny 실패 또는 날짜 미지정 시 스크래핑 fallback
        logger.info("investiny 실패 또는 날짜 미지정 → 스크래핑 fallback 사용")
        return self._fetch_cds_via_scraping()

    def fetch_all(self, start_date=None, end_date=None) -> List[EconomicIndicator]:
        """모든 데이터 수집. start_date/end_date: 'YYYY-MM-DD' 형식."""
        indicators = []

        # 기본 날짜 범위: 최근 1년
        if not start_date:
            start_date = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d')
        if not end_date:
            end_date = datetime.now().strftime('%Y-%m-%d')

        indicators.extend(self.fetch_cds_premium(start_date, end_date))
        return indicators
