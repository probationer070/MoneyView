import re
import os
import json
import requests
import pandas as pd

from typing import Optional
from datetime import datetime

"""
# Description: This module provides tools for financial data retrieval and analysis.
# 이 모듈은 금융 데이터 검색 및 분석을 위한 도구를 제공합니다.

Work Procedure:
1. Fetch stock data using the Nasdaq API.
2. Process and analyze the data using the Pandas library.

작동 원리 : 
1. Nasdaq API를 사용하여 주식 데이터를 가져옵니다.
2. Pandas 라이브러리를 사용하여 데이터를 처리하고 분석합니다.
"""

def get_apikey():
    # Placeholder function to retrieve API key
    with open("apikey.txt", "r", encoding="utf-8") as file:
        key = file.read().strip()
    return key

def divide_kr_us(stock_dict: dict):
    """
    Docstring for divide_kr_us
    
    :param stock_dict: Description
    :type stock_dict: dict
    """
    stock_kr = next(iter(stock_dict.keys()))
    stock_us = next(iter(stock_dict.values()))
    
    # 튜플 형태로 두 값을 반환
    return stock_kr, stock_us

# Function to fetch stock data from Nasdaq API
def fetch_stock_data(stock_symbol: pd.Series) -> Optional[dict]:
    """
    Docstring for fetch_stock_data
    
    :param stock_symbol: 
    stock symbol:dtype >  "센트러스 에너지": "LEU", "플루언스 에너지": "FLNC", 
    """
    stock_kr, stock_code = divide_kr_us(stock_symbol)

    url = f"https://api.nasdaq.com/api/company/{stock_code}/institutional-holdings"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://www.nasdaq.com",
        "Referer": f"https://www.nasdaq.com/market-activity/stocks/{stock_code.lower()}/institutional-holdings"
    }    

    params = {
        "apiKey": get_apikey(),
        "ticker": stock_code,         # 특정 종목 필터링 (API 스펙에 따라 파라미터명 확인 필요)
        "market": "stocks",
        "active": "true",
        "limit": 100,
        "sort": "ticker",
        "order": "asc",
        "limit": 10,
        "type": "TOTAL",
        "sortColumn": "marketValue",
        "sortOrder": "DESC"
    }

    print(f"Fetching data for {stock_code}...")
    try:
        response = requests.get(url, headers=headers, params=params)
        response.raise_for_status() # 200 OK가 아니면 예외 발생

        data = response.json()
        
        # 데이터 유효성 검사
        if data.get('data') is None:
            print("No data found.")
            return None
    except requests.exceptions.RequestException as e:
        print(f"Error fetching data: {e}")
        return None
    except Exception as e:
        print(f"Unexpected error: {e}")
        return None

    return data

# csv 형식으로 데이터 저장
def save_data_to_csv(data, symbol, filename: Optional[str]="nasdaq_institutional_holdings.csv"):
    try:
        if not data or 'data' not in data:
            print("데이터 형식이 올바르지 않습니다.")
            return

        # 1. 기관 보유 비중 (Total Institutional Ownership %)
        ownership_pct = data['data'].get('ownershipSummary', {}).get('SharesOutstandingPCT', {}).get('value', 'N/A')

        # 1-2. 상위 10대 기관 투자자
        institutional_holdings = data['data'].get('holdingsTransactions', {}).get('table', {}).get('rows', [])
        stock_kr, stock_code = divide_kr_us(symbol)

        # 2. 데이터 가공 (종목, 갱신시점, 비중, 상세정보)
        # 상세정보에는 data 전체를 JSON 문자열로 저장
        row_data = {
            '종목': stock_code+'('+stock_kr+')',
            '갱신시점': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            '기관소유비율': ownership_pct,
            '상위10대기관투자자': json.dumps(institutional_holdings, ensure_ascii=False),
            '상세정보': json.dumps(data, ensure_ascii=False)
        }

        df = pd.DataFrame([row_data])
        
        # 파일이 없으면 헤더 포함 저장, 있으면 헤더 제외하고 추가(append)
        if not os.path.exists(filename):
            df.to_csv(filename, index=False, encoding='utf-8', mode='w')
        else:
            df.to_csv(filename, index=False, encoding='utf-8', mode='a', header=False)
            
        print(f"Data appended to {filename}")
    except Exception as e:
        print(f"Error saving data to CSV: {e}")


def single_snapshot(stock: str, filename: Optional[str]) -> bool:
    """
    Docstring for single_snapshot

    단일 종목의 스냅샷 데이터를 가져와 저장합니다. 
    데이터를 가져오기 못한 종목을 따로 정리하여 마지막 출력합니다.
    
    :param 
    stock: Stock symbol
    :return: bool
    성공 여부 반환
    """

    filename = filename if filename is not None else "nasdaq_institutional_holdings.csv"
    data = fetch_stock_data(stock)
    if data:
        save_data_to_csv(data, stock, filename)
        return True
    else:
        print("데이터를 가져오지 못했습니다.")
        return False
