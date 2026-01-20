import json
import requests
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
        
            # 수집 대상 정의 (원시데이터.md 기반 통화, 재정, 물가 핵심 지표)
            targets = [
                # 1. 통화량 (M2 평잔, 원계열) - 161Y006
                ("161Y006", "BBHA00", "M2(평잔)", "십억원", "M", "통화"),
                # 1-2. 통화량 (M2 말잔, 원계열) - 161Y008
                ("161Y008", "BBGA00", "M2(말잔)", "십억원", "M", "통화"),
                # 2. 환율
                ("731Y001", "0000001", "원/미국달러", "원", "D", "환율"),
                ("731Y001", "0000053", "원/위안", "원", "D", "환율"),
                ("731Y001", "0000002", "원/일본엔(100엔)", "원", "D", "환율"),
                ("731Y001", "0000003", "원/유로", "원", "D", "환율"),
                # 국제 환율 (추정)
                ("731Y002", "0000002", "일본엔/달러", "엔", "D", "환율"),
                ("731Y002", "0000003", "달러/유로", "달러", "D", "환율"),
                # 3. 소비자물가지수 - 901Y009
                ("901Y009", "0", "CPI(총지수)", "2020=100", "M", "물가"),
                ("901Y009", "A", "CPI(식료품 및 비주류음료)", "2020=100", "M", "물가"),
                ("901Y009", "A01", "CPI(식료품)", "2020=100", "M", "물가"),
                # 4. 금리 (신규취급액) - 121Y006, 121Y002
                ("121Y006", "BECBLA01", "대출평균금리(신규)", "연%", "M", "금리"),
                ("121Y006", "BECBLA02", "기업대출금리(신규)", "연%", "M", "금리"),
                ("121Y006", "BECBLA0201", "대기업대출금리(신규)", "연%", "M", "금리"),
                ("121Y006", "BECBLA0202", "중소기업대출금리(신규)", "연%", "M", "금리"),
                ("121Y006", "BECBLA03", "가계대출금리(신규)", "연%", "M", "금리"),
                ("121Y006", "BECBLA0302", "주택담보대출금리(신규)", "연%", "M", "금리"),
                ("121Y006", "BECBLA030201", "고정형주담대금리(신규)", "연%", "M", "금리"),
                ("121Y006", "BECBLA030202", "변동형주담대금리(신규)", "연%", "M", "금리"),
                ("121Y006", "BECBLA03051", "일반신용대출금리(신규)", "연%", "M", "금리"),
                ("121Y006", "BECBLA04", "공공기타대출금리(신규)", "연%", "M", "금리"),
                ("121Y002", "BEABAA2", "저축성수신금리(신규)", "연%", "M", "금리"),
                ("121Y002", "BEABAA211", "정기예금금리(신규)", "연%", "M", "금리"),
                ("121Y002", "BEABAA2211", "CD(91일)금리(신규)", "연%", "M", "금리"),
                ("121Y002", "BEABAA224", "금융채금리(신규)", "연%", "M", "금리"),
                ("121Y002", "BEABAA1", "저축성수신(금융채제외)(신규)", "연%", "M", "금리"),
                # 4-2. 금리 (잔액 기준) - 121Y015 (New)
                ("121Y015", "BECBLB01", "총대출금리(잔액)", "연%", "M", "금리"),
                ("121Y015", "BECBLB0201", "기업대출금리(잔액)", "연%", "M", "금리"),
                ("121Y015", "BECBLB0202", "가계대출금리(잔액)", "연%", "M", "금리"),
                ("121Y013", "BEABAB2", "총수신금리(잔액)", "연%", "M", "금리"),
                ("121Y013", "BEABAB21", "저축성수신(요구불제외)(잔액)", "연%", "M", "금리"),
                # 4-1. 시장 금리 (국채/회사채) - Yahoo Finance 대체
                ("721Y001", "5020000", "국고채(3년)", "연%", "M", "금리"),
                ("721Y001", "5050000", "국고채(10년)", "연%", "M", "금리"),
                ("721Y001", "7020000", "회사채(3년,AA-)", "연%", "M", "금리"),
                # 5. 은행 예금
                ("104Y014", "BCA8", "은행수신합계", "십억원", "M", "유동성"),
                ("104Y014", "BCA1", "원화예금", "십억원", "M", "유동성"),
                ("104Y014", "BCA2", "외화예금", "십억원", "M", "유동성"),
                ("104Y014", "BCA4", "CD순발행", "십억원", "M", "유동성"),
                ("104Y014", "BCA901", "비거주자 원화예금", "십억원", "M", "외환"),
                ("104Y014", "BCA902", "비거주자 외화예금", "십억원", "M", "외환"),
                # [신규] 거주자 외화예금 (자본 유출 지표) - 036Y004
                ("036Y004", "000000", "거주자외화예금", "백만달러", "M", "외환"),
                # [신규] 외환보유액 세부 내역 - 732Y001 [A, M, Q]
                ("732Y001", "99", "외환보유액(총괄)", "천달러", "M", "외환"),
                ("732Y001", "01", "외환보유액(금)", "천달러", "M", "외환"),
                ("732Y001", "04", "외환보유액(외환)", "천달러", "M", "외환"),
                # [재정] 통합재정수지 (기존 유지)
                ("901Y013", "C", "통합재정수지", "십억원", "M", "재정"),
                # 명목 GDP (국내총생산)
                ("200Y113", "10106", "국내총생산", "십억원", "A", "경기"),
                ("200Y161", "6014", "명목 국내총생산", "십억원", "A", "경기"),
                ("902Y016", "KOR", "한국", "백만달러", "A", "경기"),
                ("902Y016", "USA", "미국", "백만달러", "A", "경기"),
                ("902Y016", "JPN", "일본", "백만달러", "A", "경기"),
            ]

            status_text.info("한국은행(ECOS) 데이터 수집 중...")
            for stat, item, name, unit, cycle, category in targets:
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
        # 미국 M2 통화량 (M2SL)
        indicators.extend(fred.fetch_indicator("M2SL", "미국 M2 통화량", "통화", "십억달러"))
        # 미국 CPI (CPIAUCSL)
        indicators.extend(fred.fetch_indicator("CPIAUCSL", "미국 CPI", "물가", "Index"))
        # 미국 기준금리 (FEDFUNDS)
        indicators.extend(fred.fetch_indicator("FEDFUNDS", "미국 기준금리", "금리", "%"))
        # 일본 국채 10년물 (IRLTLT01JPM156N)
        indicators.extend(fred.fetch_indicator("IRLTLT01JPM156N", "일본 국채 10년물", "금리", "%"))
    
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