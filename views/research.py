import streamlit as st
import plotly.graph_objects as go
import json
import math

from typing import Optional
from collections import defaultdict
# Import necessary functions from other modules
from views.stocks_news import fetch_stock_prices
from utils import load_articles_from_csv
from WebScrap.Crawler.RegulationCrawler import RegulationCrawler

def render(df=None):
    st.subheader("🔬 리서치 & 분석 (Research & Analysis)")
    st.markdown("여러 종목의 차트를 동시에 비교하고, 관련 매크로 뉴스를 검색 및 저장합니다.")

    def clean_tickers(input_str):
        return list(input_str.values())
    
    def get_ticker_mapping(
            section: Optional[str]=["all", "sector", "name", "ticker"],
            mode: Optional[str]=["custom", "total"]
    ) -> Optional[dict] :
        """
        Args:
            mode: 
                "all" (default) - 모든 티커 반환 -> output_format: dict
                "sector" - 섹터별 티커 반환 (예: {"Tech": ["AAPL", "MSFT"], "Finance": ["JPM", "BAC"]}) -> output_format: dict
                "name" - 이름별 티커 반환 (예: {"Apple": "AAPL", "Microsoft": "MSFT"}) -> output_format: dict
                "ticker" - 단순 티커 리스트 반환 (예: ["AAPL", "MSFT", "JPM", "BAC"])  -> output_format: list
        Returns:
            dict or list: mode에 따라 다름
        """
        with open("WebScrap/stock_targets.json", "r", encoding="utf-8") as f:
            data = json.load(f)
        if section == "all":
            result = data[mode]["targets"]
        if section == "sector":
            sector_tickers = defaultdict(list)
            for item in data[mode]["targets"]:
                sector = item.get("sector", "Unknown")
                sector_tickers[sector].append(item["ticker"])
            result = sector_tickers
        if section == "name":
            result = {item["name"]: item["ticker"] for item in data[mode]["targets"]}
        if section == "ticker":
            result = [item["ticker"] for item in data[mode]["targets"]]
        
        # print(f"get_ticker_mapping(section='{section}', mode='{mode}') -> {result}")
        return result

    def balance_num(json_file: str):
        """
        *.json: [formats]
        {"targets": [
            {"name": "Apple", "ticker": "AAPL"},
            ...
            {"name": "Tesla", "ticker": "TSLA"}]} 
        """
        with open(json_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        num = len(data["custom"]["targets"])
        # print(f"balance_num('{json_file}') -> num={num}")
        start = int(math.sqrt(num))

        for i in range(start, 0, -1):
            if num % i == 0:
                return i, num // i
    
    def render_stock_chart(ticker):
        """개별 종목의 캔들스틱 차트를 렌더링하는 함수"""
        with st.container(border=True):
            st.markdown(f"##### {ticker}")
            price_df = fetch_stock_prices(ticker, period="1y")
            
            if price_df is not None and not price_df.empty:
                fig = go.Figure(data=[go.Candlestick(
                    x=price_df['Date'],
                    open=price_df['Open'],
                    high=price_df['High'],
                    low=price_df['Low'],
                    close=price_df['Close'],
                    name=ticker
                )])
                fig.update_layout(
                    height=250,
                    margin=dict(l=10, r=10, t=10, b=10),
                    xaxis_rangeslider_visible=False,
                    showlegend=False
                )
                st.plotly_chart(fig, width="stretch", config={'displayModeBar': False})
            else:
                st.warning(f"{ticker} 데이터 없음")

    def display_ticker_grid(tickers, num_cols, key_suffix=""):
        """티커 리스트를 받아 지정된 컬럼 수대로 그리드에 표시하는 함수"""
        cols = st.columns(num_cols)
        for i, ticker in enumerate(tickers):
            with cols[i % num_cols]:
                render_stock_chart(ticker)










    # ===== Change View Mode =====
    if 'view_mode' not in st.session_state:
        st.session_state.view_mode = '종합'  # Default view mode

    # Create buttons to toggle between view modes
    selection = st.pills("보기 모드", ["종합", "섹터별"], selection_mode="single", default="종합")
    st.session_state.view_mode = selection

    # --- 1. Multi-Stock Grid Chart ---
    if st.session_state.view_mode == '종합':
        st.markdown("#### 멀티 종목 차트")
    # =============================


    
    targets = get_ticker_mapping(mode="custom", section="ticker")  # JSON 파일에서 티커 목록을 가져오는 함수  
    tickers = [t for t in targets if t]  # 유효한 티커만 필터링
    st.text_area("비교할 종목 티커를 입력하세요 (쉼표, 공백, 줄바꿈으로 구분)", tickers)
    if st.session_state.view_mode == '종합':
        if tickers:
            default_cols = balance_num("WebScrap/stock_targets.json")[0]
            num_cols = st.number_input("한 줄에 표시할 차트 수", min_value=1, max_value=5, value=default_cols)
            display_ticker_grid(tickers, num_cols)

    elif st.session_state.view_mode == '섹터별':
        st.markdown("#### 섹터별 종목 차트")
        
        # 데이터 그룹화
        fixed_targets = get_ticker_mapping(mode="total", section="all")  # 섹터별 티커 딕셔너리
        sector_mapping = defaultdict(list)
        for target in fixed_targets:
            sector = target.get("sector", "else")
            sector_mapping[sector].append(target["ticker"])

        # 섹터별 출력
        for sector, s_tickers in sector_mapping.items():
            st.markdown(f"##### 섹터: {sector}")
            # 각 섹터별로 고유한 key를 위해 sector 이름을 label에 포함
            num_cols = st.number_input(f"'{sector}' 한 줄에 표시할 차트 수", 
                                    min_value=1, max_value=5, 
                                    value=min(3, len(s_tickers)),
                                    key=f"input_{sector}")
            display_ticker_grid(s_tickers, num_cols)










    st.markdown("---")

    # --- 2. Macro News Search & Save ---
    st.markdown("#### 매크로 뉴스 검색 및 저장")
    
    crawler = RegulationCrawler()
    
    search_query = st.text_input("검색할 매크로 뉴스 키워드를 입력하세요 (예: FOMC, 파월, 유가)", key="macro_search_query")
    
    if st.button("뉴스 검색", key="search_macro_news"):
        if search_query:
            with st.spinner(f"'{search_query}' 관련 뉴스를 검색 중입니다..."):
                st.session_state.macro_search_results = crawler.crawl(query=search_query, limit=10, filepath=f"src/macro/events.csv")
        else:
            st.warning("검색어를 입력해주세요.")
            st.session_state.macro_search_results = [] # Clear previous results

    if 'macro_search_results' in st.session_state and st.session_state.macro_search_results:
        st.markdown("##### 검색 결과")
        st.session_state.macro_search_results










    st.markdown("---")

    # Display saved macro events
    st.markdown("#### 저장된 매크로 이벤트 목록")
    articles = load_articles_from_csv(f"src/macro/events.csv")
    # 최신순 정렬 및 상위 5개 필터링
    if articles:
        articles = sorted(articles, key=lambda x: x.get('Timestamp', ''), reverse=True)[:5]
    
    if articles:
        st.markdown("#### 등록된 뉴스 목록 (최신 5개)")
        for a in articles:
            st.markdown(f"- [{a.get('Date', '')[:-1]}] [{a.get('Title', '제목 없음')}]({a.get('URL', '#')})")
    