import json
import requests
import yfinance as yf
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

@dataclass
class EconomicIndicator:
    """
    경제 지표 데이터를 담는 클래스
    (ECOS, FRED, Yahoo Finance 등에서 수집된 정량 데이터)
    """
    category: str          # 예: "한국 내부 요인", "글로벌 매크로"
    name: str              # 지표명 (예: M2 통화량, 달러 인덱스)
    code: str              # API 코드 또는 티커 (예: 102Y004, DXY)
    value: float           # 지표 값
    unit: str              # 단위 (예: 십억원, %, pt)
    date: str              # 기준 일자 (YYYY-MM-DD)
    source: str            # 출처 (예: ECOS, Yahoo, FRED)
    description: str = ""  # 추가 설명

@dataclass
class RiskNews:
    """
    금융 규제 및 리스크 관련 뉴스/공지사항 데이터를 담는 클래스
    """
    source: str            # 출처 (예: 금융감독원, 금융위원회)
    title: str             # 제목
    url: str               # 링크
    date: str              # 게시 일자
    matched_keywords: List[str] = field(default_factory=list) # 매칭된 키워드


# ==========================================
# 2. 데이터 수집기 (Collectors)
# ==========================================

class ECOSCollector:
    """
    1. 한국 내부 요인: 한국은행 경제통계시스템 (ECOS) 수집기
    """
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "http://ecos.bok.or.kr/api/StatisticSearch"

    def fetch_indicator(self, stat_code: str, item_code: str, name: str, unit: str, cycle: str = "M", year: Optional[int] = None) -> Optional[EconomicIndicator]:
        """ECOS API를 호출하여 최신 지표 하나를 가져옵니다."""
        # URL 포맷: /인증키/json/kr/1/1/통계표코드/주기/검색시작일자/검색종료일자/항목코드
        # 편의상 최근 데이터 1건만 조회하도록 설정
        # 날짜 동적 설정 (최근 2년 데이터 조회하여 최신값 확보)
        # now = datetime.now()
        
        if cycle == "D":
            # 일별 데이터는 너무 긴 기간을 요청하면 페이징 제한(100건)에 걸릴 수 있으므로 최근 2주만 조회
            start_date = (datetime.now() - timedelta(days=30)).strftime("%Y%m%d")
            end_date = datetime.now().strftime("%Y%m%d")
        elif cycle == "A":
            start_date = f"{year - 1}"
            end_date = f"{year}"
        else: # Default M (Monthly)
            start_date = f"{year - 1}01"
            end_date = f"{year}12"
            
        url = f"{self.base_url}/{self.api_key}/json/kr/1/1/{stat_code}/{cycle}/{start_date}/{end_date}/{item_code}"
        
        try:
            response = requests.get(url)
            data = response.json()
            
            if 'StatisticSearch' in data and 'row' in data['StatisticSearch']:
                # API는 오름차순(과거->최신)으로 데이터를 반환하므로 마지막 요소([-1])가 최신 데이터임
                row = data['StatisticSearch']['row'][-1]
                return EconomicIndicator(
                    category="한국 내부 요인",
                    name=name,
                    code=item_code,
                    value=float(row['DATA_VALUE']),
                    unit=unit,
                    date=row['TIME'],
                    source="ECOS"
                )
            else:
                logger.warning(f"ECOS 데이터 없음: {name} ({item_code}) URL: {url}")
                return None
        except Exception as e:
            logger.error(f"ECOS API 오류 ({name}): {e}")
            return None


class GlobalMacroCollector:
    """
    2. 자본 비용 & 4. 글로벌 매크로: Yahoo Finance 및 FRED 데이터 수집기
    """
    def __init__(self):
        self.yahoo_tickers = {
            # 글로벌 매크로
            "DX-Y.NYB": ("달러 인덱스 (DXY)", "글로벌 매크로"), # Yahoo Ticker for DXY
            "^TNX": ("미국 10년물 국채 금리", "글로벌 매크로"), # CBOE Interest Rate 10 Year T Note
            "GC=F": ("금 선물", "글로벌 매크로"),
            "HG=F": ("구리 선물", "글로벌 매크로"),
            "URA": ("Global X Uranium ETF", "글로벌 매크로"),
            "BTC-USD": ("비트코인", "글로벌 매크로")
        }

    def fetch_yahoo_data(self) -> List[EconomicIndicator]:
        results = []
        for ticker, (name, category) in self.yahoo_tickers.items():
            try:
                # yfinance를 사용하여 데이터 가져오기
                stock = yf.Ticker(ticker)
                # 최근 1일치 데이터
                hist = stock.history(period="1d")
                
                if not hist.empty:
                    last_price = hist['Close'].iloc[-1]
                    last_date = hist.index[-1].strftime('%Y-%m-%d')
                    
                    results.append(EconomicIndicator(
                        category=category,
                        name=name,
                        code=ticker,
                        value=round(last_price, 2),
                        unit="Point/Price",
                        date=last_date,
                        source="Yahoo Finance"
                    ))
                else:
                    logger.warning(f"Yahoo Finance 데이터 없음: {name} ({ticker})")
            except Exception as e:
                logger.error(f"Yahoo Finance 오류 ({name}): {e}")
        return results

    # FRED 데이터는 pandas_datareader 등을 사용하여 확장 가능


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
            # 금융위원회 등 추가 가능
        ]
        self.keywords = ["해외 송금 제한", "서학개미 규제", "환전 증거금", "외화 스트레스 테스트", "자본 유출"]

    def crawl(self) -> List[RiskNews]:
        results = []
        for target in self.targets:
            try:
                response = requests.get(target['url'], timeout=10)
                soup = BeautifulSoup(response.text, 'html.parser')
                
                # FSS 보도자료 게시판 구조에 맞춘 파싱 (구조 변경 시 수정 필요)
                # 통상적으로 게시판은 table > tbody > tr 구조를 가짐
                rows = soup.select('table tbody tr')
                
                for row in rows:
                    title_tag = row.select_one('.subject a') # 제목 태그
                    date_tag = row.select_one('td:nth-child(4)') # 날짜 태그 (인덱스 확인 필요)
                    
                    if title_tag:
                        title = title_tag.text.strip()
                        link = target['base_url'] + title_tag['href'] if title_tag['href'].startswith('/') else title_tag['href']
                        date = date_tag.text.strip() if date_tag else datetime.now().strftime('%Y-%m-%d')
                        
                        # 키워드 매칭 확인
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

def run_dashboard_collection():
    print("🛡️ 생존형 경제 대시보드 데이터 수집 시작...")
    
    all_indicators: List[EconomicIndicator] = []
    all_news: List[RiskNews] = []

    # 1. ECOS 수집
    # 주의: 실제 API 키를 발급받아 입력해야 합니다.
    ecos_key = json.load(open("./apikey.json"))["ECOS_API_KEY"]
    ecos = ECOSCollector(ecos_key)
    
    # ECOS 코드 매핑 (통계표코드, 항목코드) - 원시데이터.md 기반
    # 통계표 코드는 일반적인 ECOS 코드를 기준으로 추정하여 작성됨 (101Y004: M2, 731Y001: 환율, 901Y010: 물가, 121Y006: 금리, 104Y002: 예금)
    ecos_targets = [
        # 1. 통화량 (M2 평잔, 원계열) - 161Y006
        ("161Y006", "BBHA00", "M2(평잔)", "십억원", "M"),
        ("161Y006", "BBHA01", "M2(평잔-가계)", "십억원", "M"),      # BBHAJ1 -> BBHA01
        ("161Y006", "BBHA02", "M2(평잔-기업)", "십억원", "M"),      # BBHAJ2 -> BBHA02
        ("161Y006", "BBHA03", "M2(평잔-기타금융)", "십억원", "M"),  # BBHAJ3 -> BBHA03
        ("161Y006", "BBHA04", "M2(평잔-기타)", "십억원", "M"),      # BBHAJ4 -> BBHA04

        # 1-2. 통화량 (M2 말잔, 원계열) - 161Y008 (New)
        ("161Y008", "BBGA00", "M2(말잔)", "십억원", "M"),
        ("161Y008", "BBGA01", "M2(말잔-가계)", "십억원", "M"),      # BBGAJ1 -> BBGA01
        ("161Y008", "BBGA02", "M2(말잔-기업)", "십억원", "M"),      # BBGAJ2 -> BBGA02
        ("161Y008", "BBGA03", "M2(말잔-기타금융)", "십억원", "M"),  # BBGAJ3 -> BBGA03
        ("161Y008", "BBGA04", "M2(말잔-기타)", "십억원", "M"),      # BBGAJ4 -> BBGA04

        # 2. 환율
        ("731Y001", "0000001", "원/미국달러", "원", "D"),
        ("731Y001", "0000053", "원/위안", "원", "D"),
        ("731Y001", "0000002", "원/일본엔(100엔)", "원", "D"),
        ("731Y001", "0000003", "원/유로", "원", "D"),
        
        # 국제 환율 (추정)
        ("731Y002", "0000002", "일본엔/달러", "엔", "D"),
        ("731Y002", "0000003", "달러/유로", "달러", "D"),

        # 3. 소비자물가지수 - 901Y009
        ("901Y009", "0", "CPI(총지수)", "2020=100", "M"),
        ("901Y009", "A", "CPI(식료품 및 비주류음료)", "2020=100", "M"),
        ("901Y009", "A01", "CPI(식료품)", "2020=100", "M"),

        # 4. 금리 (신규취급액) - 121Y006, 121Y002
        ("121Y006", "BECBLA01", "대출평균금리(신규)", "연%", "M"),
        ("121Y006", "BECBLA02", "기업대출금리(신규)", "연%", "M"),
        ("121Y006", "BECBLA0201", "대기업대출금리(신규)", "연%", "M"),
        ("121Y006", "BECBLA0202", "중소기업대출금리(신규)", "연%", "M"),
        ("121Y006", "BECBLA03", "가계대출금리(신규)", "연%", "M"),
        ("121Y006", "BECBLA0302", "주택담보대출금리(신규)", "연%", "M"),
        ("121Y006", "BECBLA030201", "고정형주담대금리(신규)", "연%", "M"),
        ("121Y006", "BECBLA030202", "변동형주담대금리(신규)", "연%", "M"),
        ("121Y006", "BECBLA03051", "일반신용대출금리(신규)", "연%", "M"),
        ("121Y006", "BECBLA04", "공공기타대출금리(신규)", "연%", "M"),

        ("121Y002", "BEABAA2", "저축성수신금리(신규)", "연%", "M"),
        ("121Y002", "BEABAA211", "정기예금금리(신규)", "연%", "M"),
        ("121Y002", "BEABAA2211", "CD(91일)금리(신규)", "연%", "M"),
        ("121Y002", "BEABAA224", "금융채금리(신규)", "연%", "M"),
        ("121Y002", "BEABAA1", "저축성수신(금융채제외)(신규)", "연%", "M"),
        # 4-2. 금리 (잔액 기준) - 121Y015 (New)
        ("121Y015", "BECBLB01", "총대출금리(잔액)", "연%", "M"),
        ("121Y015", "BECBLB0201", "기업대출금리(잔액)", "연%", "M"),
        ("121Y015", "BECBLB0202", "가계대출금리(잔액)", "연%", "M"),
        ("121Y013", "BEABAB2", "총수신금리(잔액)", "연%", "M"),
        ("121Y013", "BEABAB21", "저축성수신(요구불제외)(잔액)", "연%", "M"),
        
        # 4-1. 시장 금리 (국채/회사채) - Yahoo Finance 대체
        ("721Y001", "5050000", "국고채(10년)", "연%", "M"),
        ("721Y001", "5020000", "국고채(3년)", "연%", "M"),
        ("721Y001", "7020000", "회사채(3년,AA-)", "연%", "M"),

        # 5. 은행 예금
        ("104Y014", "BCA8", "은행수신합계", "십억원", "M"),
        ("104Y014", "BCA1", "원화예금", "십억원", "M"),
        ("104Y014", "BCA2", "외화예금", "십억원", "M"),
        ("104Y014", "BCA4", "CD순발행", "십억원", "M"),
        ("104Y014", "BCA901", "비거주자 원화예금", "십억원", "M"),
        ("104Y014", "BCA902", "비거주자 외화예금", "십억원", "M"),
    ]
    
    if ecos_key != "YOUR_ECOS_API_KEY":
        for stat, item, name, unit, cycle in ecos_targets:
            data = ecos.fetch_indicator(stat, item, name, unit, cycle, year=2025)
            if data:
                all_indicators.append(data)
    else:
        logger.warning("ECOS API Key가 설정되지 않아 한국은행 데이터를 건너뜁니다.")

    # 2 & 4. 글로벌 매크로 및 시장 데이터 수집
    # macro = GlobalMacroCollector()
    # all_indicators.extend(macro.fetch_yahoo_data())

    # 3. 규제 뉴스 크롤링
    crawler = RegulationCrawler()
    all_news.extend(crawler.crawl())

    # 5. 시스템 리스크 (구현 필요 부분 포함)
    risk = SystemRiskFetcher()
    all_indicators.extend(risk.fetch_risk_metrics())

    # --- 결과 출력 ---
    print("\n[📊 수집된 경제 지표]")
    for ind in all_indicators:
        print(f"[{ind.category}] {ind.name}: {ind.value} {ind.unit} ({ind.date})")

    print("\n[🚨 감지된 규제/리스크 뉴스]")
    if not all_news:
        print("특이사항 없음 (키워드 매칭된 뉴스 없음)")
    for news in all_news:
        print(f"[{news.source}] {news.title} - {news.date}")
        print(f"   Link: {news.url}")
        print(f"   Keywords: {news.matched_keywords}")

if __name__ == "__main__":
    run_dashboard_collection()