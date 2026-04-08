from typing import List, Optional, Dict
from ..DAO import EconomicIndicator
from ..Collector.BaseCollector import BaseCollector
import requests
import logging
from datetime import datetime

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
            "BTC-USD": ("비트코인", "글로벌 매크로"),
            "EWY": ("MSCI South Korea iShares", "글로벌 매크로"),
            "TTF=F": ("EU 천연가스 (Euro/MWh)", "글로벌 매크로") # Dutch TTF Gas
        }

    def fetch_indicator(self, *args, **kwargs) -> List[EconomicIndicator]:
        """BaseCollector 추상 메서드 구현"""
        return self.fetch_yahoo_data(start_date=kwargs.get('start_date'), end_date=kwargs.get('end_date'))

    def fetch_yahoo_data(self, start_date: Optional[str] = None, end_date: Optional[str] = None) -> List[EconomicIndicator]:
        results = []
        # nasdaq.py와 유사하게 헤더를 설정하여 봇 차단을 우회합니다.
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
            "Origin": "https://finance.yahoo.com",
            "Referer": "https://finance.yahoo.com/"
        }

        for ticker, (name, category) in self.yahoo_tickers.items():
            try:
                # yfinance 라이브러리 대신 requests로 직접 API 호출
                url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
                
                params = {
                    "interval": "1d",
                    "events": "history"
                }

                if start_date and end_date:
                    dt_start = datetime.strptime(start_date, "%Y-%m-%d")
                    dt_end = datetime.strptime(end_date, "%Y-%m-%d")
                    params["period1"] = int(dt_start.timestamp())
                    params["period2"] = int(dt_end.timestamp())
                else:
                    params["range"] = "5y"
                
                response = requests.get(url, headers=headers, params=params, timeout=10)
                response.raise_for_status()
                data = response.json()
                
                chart_result = data.get("chart", {}).get("result")
                if chart_result:
                    quote = chart_result[0]
                    timestamps = quote.get("timestamp", [])
                    closes = quote.get("indicators", {}).get("quote", [{}])[0].get("close", [])
                    
                    for ts, price in zip(timestamps, closes):
                        if price is None: continue
                        date_str = datetime.fromtimestamp(ts).strftime('%Y-%m-%d')
                        results.append(EconomicIndicator(
                            category=category,
                            name=name,
                            code=ticker,
                            value=round(float(price), 2),
                            unit="Point/Price",
                            date=date_str,
                            source="Yahoo Finance"
                        ))
                else:
                    logger.warning(f"Yahoo Finance 데이터 없음 (응답 비어있음): {name} ({ticker})")
            except Exception as e:
                logger.error(f"Yahoo Finance 오류 ({name}): {e}")
        return results

    # FRED 데이터는 pandas_datareader 등을 사용하여 확장 가능
