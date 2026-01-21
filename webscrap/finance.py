import json
import requests
import os
# import yfinance as yf
import streamlit as st
from bs4 import BeautifulSoup
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import List, Optional, Dict
import logging

# 로깅 설정
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ==========================================
# 1. 데이터 형식 정의 (Data Transfer Objects)
# ==========================================

from .DAO import EconomicIndicator, RiskNews
from .Collector import ECOSCollector, GlobalMacroCollector, FREDCollector

class RegulationCrawler:
    """
    3. 금융 억압 및 규제 감시: 금융감독원/금융위원회 크롤러
    """
    def __init__(self):
        self.targets = [
            {
                "name": "금융감독원 보도자료",
                "url": "https://www.fss.or.kr/fss/bbs/B0000188/list.do?menuNo=200218",
                "base_url": "https://www.fss.or.kr"
            },
        ]
        self.keywords = ["해외 송금 제한", "서학개미 규제", "환전 증거금", "외화 스트레스 테스트", "자본 유출"]

    def crawl(self) -> List[RiskNews]:
        results = []
        for target in self.targets:
            try:
                response = requests.get(target['url'], timeout=10)
                soup = BeautifulSoup(response.text, 'html.parser')
                
                rows = soup.select('table tbody tr')
                
                for row in rows:
                    title_tag = row.select_one('.subject a')
                    date_tag = row.select_one('td:nth-child(4)')
                    
                    if title_tag:
                        title = title_tag.text.strip()
                        link = target['base_url'] + title_tag['href'] if title_tag['href'].startswith('/') else title_tag['href']
                        date = date_tag.text.strip() if date_tag else datetime.now().strftime('%Y-%m-%d')
                        
                        matched = [k for k in self.keywords if k in title]
                        
                        if matched:
                            results.append(RiskNews(
                                source=target['name'],
                                title=title,
                                url=link,
                                date=date,
                                matched_keywords=matched
                            ))
            except Exception as e:
                logger.error(f"크롤링 오류 ({target['name']}): {e}")
        
        return results



# ==========================================
# 2. 데이터 수집기 (Collectors)
# ==========================================

class SystemRiskFetcher:
    """
    5. 시스템 리스크: 공공 데이터 및 파산 건수
    (API가 없는 경우 크롤링 로직이 복잡하므로 구조만 예시로 작성)
    """
    def fetch_risk_metrics(self) -> List[EconomicIndicator]:
        # 예시: 법인 파산 건수 (실제로는 대법원 통계 사이트 크롤링 필요)
        # 여기서는 더미 데이터를 반환하거나 구현이 필요함을 알림
        return [
            EconomicIndicator(
                category="시스템 리스크",
                name="법인 파산 건수 (예시)",
                code="COURT_BANKRUPTCY",
                value=0.0, # 구현 필요
                unit="건",
                date=datetime.now().strftime('%Y-%m-%d'),
                source="대법원/FISIS",
                description="구현 필요: 대법원 통계 월별 업데이트 크롤링"
            )
        ]


# ==========================================
# 3. 메인 실행 컨트롤러
# ==========================================

def format_ecos_date(dt, cycle):
    """ECOS API 요청용 날짜 포맷 변환"""
    if cycle == 'D': return dt.strftime("%Y%m%d")
    if cycle == 'M': return dt.strftime("%Y%m")
    if cycle == 'Q': return f"{dt.year}Q{(dt.month-1)//3 + 1}"
    if cycle == 'A': return dt.strftime("%Y")
    return dt.strftime("%Y%m")

def fetch_latest_data(ecos_api_key, fred_api_key, start_date=None, end_date=None, sources=None):
    """ECOS 및 Yahoo Finance에서 최신 데이터를 수집합니다."""
    if sources is None:
        sources = ["ECOS", "FRED", "Yahoo"]
        
    indicators = []
    status_text = st.empty()
    
    # 1. ECOS 수집기 초기화
    if "ECOS" in sources:
        if not ecos_api_key:
            st.error("ECOS API 키가 필요합니다.")
        else:
            ecos = ECOSCollector(ecos_api_key)
            
            # JSON 파일에서 수집 대상 로드
            try:
                target_file_path = os.path.join(os.path.dirname(__file__), 'ecos_targets.json')
                with open(target_file_path, 'r', encoding='utf-8') as f:
                    targets = json.load(f)
            except FileNotFoundError:
                st.error("`ecos_targets.json` 파일을 찾을 수 없습니다.")
                targets = []
            except json.JSONDecodeError:
                st.error("`ecos_targets.json` 파일의 형식이 잘못되었습니다.")
                targets = []

            status_text.info("한국은행(ECOS) 데이터 수집 중...")
            for target in targets:
                stat = target.get('stat_code')
                item = target.get('item_code')
                name = target.get('name')
                unit = target.get('unit')
                cycle = target.get('cycle')
                category = target.get('category')

                s_str, e_str = None, None
                if start_date and end_date:
                    s_str = format_ecos_date(start_date, cycle)
                    e_str = format_ecos_date(end_date, cycle)

                data_list = ecos.fetch_indicator(stat, item, name, unit, cycle, year=datetime.now().year, start_date=s_str, end_date=e_str, category=category)
                if data_list:
                    indicators.extend(data_list)
    
    # 2. FRED 데이터 수집
    if "FRED" in sources and fred_api_key:
        status_text.info("FRED 데이터 수집 중...")
        fred = FREDCollector(fred_api_key)
        
        f_start = start_date.strftime("%Y-%m-%d") if start_date else None
        f_end = end_date.strftime("%Y-%m-%d") if end_date else None
        
        # 미국 M2 통화량 (M2SL)
        indicators.extend(fred.fetch_indicator("M2SL", "미국 M2 통화량", "통화", "십억달러", start_date=f_start, end_date=f_end))
        # 미국 CPI (CPIAUCSL)
        indicators.extend(fred.fetch_indicator("CPIAUCSL", "미국 CPI", "물가", "Index", start_date=f_start, end_date=f_end))
        # 미국 기준금리 (FEDFUNDS)
        indicators.extend(fred.fetch_indicator("FEDFUNDS", "미국 기준금리", "금리", "%", start_date=f_start, end_date=f_end))
        # 일본 국채 10년물 (IRLTLT01JPM156N)
        indicators.extend(fred.fetch_indicator("IRLTLT01JPM156N", "일본 국채 10년물", "금리", "%", start_date=f_start, end_date=f_end))
    
    # 3. 글로벌 매크로 (Yahoo Finance)
    if "Yahoo" in sources:
        status_text.info("글로벌 매크로 데이터 수집 중...")
        macro = GlobalMacroCollector()
        # Yahoo Finance는 YYYY-MM-DD 형식을 사용
        y_start = start_date.strftime("%Y-%m-%d") if start_date else None
        y_end = end_date.strftime("%Y-%m-%d") if end_date else None
        
        yahoo_data = macro.fetch_yahoo_data(start_date=y_start, end_date=y_end)
        # Yahoo 데이터 카테고리 후처리
        for ind in yahoo_data:
            if ind.code == "DX-Y.NYB": ind.category = "환율"
            elif ind.code == "^TNX": ind.category = "금리"
            elif ind.code in ["GC=F", "HG=F", "URA", "BTC-USD"]: ind.category = "자산"
            else: ind.category = "글로벌 매크로"
        indicators.extend(yahoo_data)
    
    status_text.success(f"수집 완료! 총 {len(indicators)}건의 데이터가 업데이트되었습니다.")
    return indicators

# if __name__ == "__main__":
#     run_dashboard_collection()