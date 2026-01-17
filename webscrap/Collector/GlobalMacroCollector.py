from typing import List, Optional, Dict
from WebScrap.DAO import EconomicIndicator
from WebScrap.Collector.BaseCollector import BaseCollector
import yfinance as yf
import logging

logger = logging.getLogger(__name__)

class GlobalMacroCollector(BaseCollector):
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

    def fetch_indicator(self, *args, **kwargs) -> List[EconomicIndicator]:
        """BaseCollector 추상 메서드 구현"""
        return self.fetch_yahoo_data(start_date=kwargs.get('start_date'), end_date=kwargs.get('end_date'))

    def fetch_yahoo_data(self, start_date: Optional[str] = None, end_date: Optional[str] = None) -> List[EconomicIndicator]:
        results = []
        for ticker, (name, category) in self.yahoo_tickers.items():
            try:
                # yfinance를 사용하여 데이터 가져오기
                stock = yf.Ticker(ticker)
                # 최근 1년치 데이터 또는 지정 기간
                if start_date and end_date:
                    hist = stock.history(start=start_date, end=end_date)
                else:
                    hist = stock.history(period="1y")
                
                if not hist.empty:
                    for date, row in hist.iterrows():
                        price = row['Close']
                        date_str = date.strftime('%Y-%m-%d')
                        
                        results.append(EconomicIndicator(
                            category=category,
                            name=name,
                            code=ticker,
                            value=round(price, 2),
                            unit="Point/Price",
                            date=date_str,
                            source="Yahoo Finance"
                        ))
                else:
                    logger.warning(f"Yahoo Finance 데이터 없음: {name} ({ticker})")
            except Exception as e:
                logger.error(f"Yahoo Finance 오류 ({name}): {e}")
        return results

    # FRED 데이터는 pandas_datareader 등을 사용하여 확장 가능
