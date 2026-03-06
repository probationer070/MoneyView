import streamlit as st
import pandas as pd
import plotly.graph_objects as go

# Import necessary functions from other modules
from views.stocks_news import fetch_stock_prices, scrape_and_save_article, load_json
from WebScrap.Crawler.RegulationCrawler import RegulationCrawler

def render(df=None):
    st.subheader("🔬 리서치 & 분석 (Research & Analysis)")
    st.markdown("여러 종목의 차트를 동시에 비교하고, 관련 매크로 뉴스를 검색 및 저장합니다.")

    # --- 1. Multi-Stock Grid Chart ---
    st.markdown("#### 멀티 종목 차트")
    tickers_input = st.text_area("비교할 종목 티커를 입력하세요 (쉼표, 공백, 줄바꿈으로 구분)", "AAPL MSFT GOOGL\nNVDA TSLA AMZN")
    
    # Split by comma, space, or newline
    tickers = [t for ticker in tickers_input.replace(",", " ").replace("\n", " ").split(" ") if (t := ticker.strip())]

    if tickers:
        num_cols = st.number_input("한 줄에 표시할 차트 수", min_value=1, max_value=5, value=3)
        cols = st.columns(num_cols)
        
        for i, ticker in enumerate(tickers):
            with cols[i % num_cols]:
                with st.container(border=True):
                    st.markdown(f"##### {ticker}")
                    price_df = fetch_stock_prices(ticker, period="1y")
                    
                    if price_df is not None and not price_df.empty:
                        fig = go.Figure(data=[go.Candlestick(x=price_df['Date'],
                                    open=price_df['Open'],
                                    high=price_df['High'],
                                    low=price_df['Low'],
                                    close=price_df['Close'],
                                    name=ticker)])
                        fig.update_layout(
                            height=250,
                            margin=dict(l=10, r=10, t=10, b=10),
                            xaxis_rangeslider_visible=False,
                            showlegend=False
                        )
                        st.plotly_chart(fig, width="stretch", config={'displayModeBar': False})
                    else:
                        st.warning(f"{ticker} 데이터 없음")

    st.markdown("---")

    # --- 2. Macro News Search & Save ---
    st.markdown("#### 매크로 뉴스 검색 및 저장")
    
    crawler = RegulationCrawler()
    
    search_query = st.text_input("검색할 매크로 뉴스 키워드를 입력하세요 (예: FOMC, 파월, 유가)", key="macro_search_query")
    
    if st.button("뉴스 검색", key="search_macro_news"):
        if search_query:
            with st.spinner(f"'{search_query}' 관련 뉴스를 검색 중입니다..."):
                st.session_state.macro_search_results = crawler.crawl(query=search_query, limit=10)
        else:
            st.warning("검색어를 입력해주세요.")
            st.session_state.macro_search_results = [] # Clear previous results

    if 'macro_search_results' in st.session_state and st.session_state.macro_search_results:
        st.markdown("##### 검색 결과")
        results = st.session_state.macro_search_results
        
        for i, news in enumerate(results):
            col1, col2 = st.columns([4, 1])
            with col1:
                st.markdown(f"[{news.title}]({news.url}) <br> <span style='color:gray; font-size:0.8em;'>{news.date[:10]}</span>", unsafe_allow_html=True)
            with col2:
                if st.button("이벤트로 저장", key=f"save_macro_{i}"):
                    with st.spinner(f"'{news.title}' 스크랩 및 저장 중..."):
                        success, msg, _ = scrape_and_save_article(news.url, is_macro=True, rss_title=news.title)
                        if success:
                            st.success(f"저장 완료")
                        else:
                            st.error(f"저장 실패: {msg}")
    
    st.markdown("---")
    
    # Display saved macro events
    st.markdown("#### 저장된 매크로 이벤트 목록")
    macro_events = load_json("saved_data/macro/events.json")
    if macro_events:
        for a in reversed(macro_events):
            with st.expander(f"[{a['publication_date'][:10]}] {a['headline']} (중요도: {a['importance']})"):
                st.markdown(f"**URL:** [{a['url']}]({a['url']})")
                st.write(a['cleaned_content'])
    else:
        st.info("저장된 매크로 이벤트가 없습니다.")