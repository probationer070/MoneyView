import streamlit as st
import yfinance as yf
import pandas as pd
import plotly.graph_objects as go
from datetime import datetime
import os
import json

from WebScrap.Crawler.RegulationCrawler import RegulationCrawler
from utils import load_articles_from_csv

@st.cache_data(ttl=3600) # 캐시를 1시간(3600초) 동안 유지
def fetch_stock_prices(ticker, period="1y"):
    save_dir = f"src/stocks/{ticker}"
    os.makedirs(save_dir, exist_ok=True)
    save_path = os.path.join(save_dir, "prices.csv")
    
    try:
        ticker_obj = yf.Ticker(ticker)
        df = ticker_obj.history(period=period)
        if not df.empty:
            df.reset_index(inplace=True)
            if 'Date' not in df.columns and 'Datetime' in df.columns:
                df.rename(columns={'Datetime': 'Date'}, inplace=True)
            if 'Date' in df.columns:
                df['Date'] = pd.to_datetime(df['Date'])
                if df['Date'].dt.tz is not None:
                    df['Date'] = df['Date'].dt.tz_localize(None)
            df.to_csv(save_path, index=False)
            return df
    except Exception as e:
        print(f"Warning: yfinance fetch failed for {ticker}: {e}")
        
    if os.path.exists(save_path):
        try:
            return pd.read_csv(save_path, parse_dates=["Date"])
        except:
            return pd.DataFrame()
    return pd.DataFrame()

def render_chart(df, articles, title):
    if df is None or df.empty:
        st.warning(f"가격 데이터가 없습니다: {title}")
        return
        
    fig = go.Figure(data=[go.Candlestick(x=df['Date'],
                open=df['Open'],
                high=df['High'],
                low=df['Low'],
                close=df['Close'],
                name="Price")])

    # Overlay events
    if articles:
        event_dates = []
        event_y = []
        event_texts = []
        event_colors = []
        
        for a in articles:
            try:
                dt = datetime.strptime(a['publication_date'].split()[0], "%Y-%m-%d")
                mask = df['Date'].dt.date == dt.date()
                if mask.any():
                    y_val = df.loc[mask, 'High'].values[0] * 1.05
                else:
                    continue
                    
                event_dates.append(df.loc[mask, 'Date'].values[0])
                event_y.append(y_val)
                event_texts.append(f"<b>{a['headline']}</b><br>Importance: {a['importance']}")
                color = 'red' if a['importance'] == 5 else 'blue'
                event_colors.append(color)
            except:
                pass
                
        if event_dates:
            fig.add_trace(go.Scatter(
                x=event_dates,
                y=event_y,
                mode='markers',
                marker=dict(size=12, color=event_colors, symbol='star'),
                name='News Events',
                text=event_texts,
                hoverinfo='text'
            ))

    fig.update_layout(
        title=title,
        xaxis_title="Date",
        yaxis_title="Price",
        height=600,
        margin=dict(l=20, r=20, t=50, b=20)
    )
    
    st.plotly_chart(fig, width='stretch')

def render(df_global=None):
    st.markdown("### 📊 개별 주식 & 뉴스 (Stocks & News)")
    
    crawler = RegulationCrawler()
    
    tab1, tab2 = st.tabs(["기업 지표 및 종목 뉴스", "거시 경제 (Macro) 이벤트"])
    
    with tab1:
        ticker = st.text_input("종목 티커 입력 (예: AAPL, TSLA, 005930.KS)", value="AAPL")
        
        col1, col2 = st.columns([3, 1])
        
        with col2:
            st.markdown("#### 특정 뉴스 스크랩 추가")
            new_url = st.text_input("추가할 뉴스 URL", key="news_url")
            if st.button("뉴스 스크랩 및 저장"):
                if new_url:
                    filepath = f"src/stocks/{ticker}/articles.csv"
                    with st.spinner("스크랩 중..."):
                        success, msg, entry = crawler.scrape_and_save_article(
                            url=new_url,
                            filepath=filepath,
                            keyword=ticker
                        )
                    if success:
                        st.success(msg)
                        st.rerun()
                    else:
                        st.error(msg)

        with col1:
            if ticker:
                df = fetch_stock_prices(ticker)
                articles = load_articles_from_csv(f"src/stocks/{ticker}/articles.csv")
                
                # 최신순 정렬 및 상위 5개 필터링
                if articles:
                    articles = sorted(articles, key=lambda x: x.get('publication_date', ''), reverse=True)[:5]

                render_chart(df, articles, f"{ticker} 주가 및 뉴스 이벤트")
                
                if articles:
                    st.markdown("#### 등록된 뉴스 목록 (최신 5개)")
                    for a in articles:
                        st.markdown(f"- [{a.get('publication_date', '')[:10]}] [{a.get('headline', '제목 없음')}]({a.get('url', '#')})")

    with tab2:
        st.markdown("#### 매크로 이벤트 수동 추가")
        st.markdown("대통령 발언, 연준 발표 등 시장 전체에 영향을 미치는 뉴스를 추가합니다.")
        macro_url = st.text_input("매크로 뉴스 URL", key="macro_url")
        if st.button("매크로 이벤트 저장"):
            if macro_url:
                filepath = "src/macro/events.csv"
                with st.spinner("스크랩 중..."):
                    success, msg, entry = crawler.scrape_and_save_article(
                        url=macro_url,
                        filepath=filepath,
                        keyword="macro_manual"
                    )
                if success:
                    st.success(msg)
                    st.rerun()
                else:
                    st.error(msg)
                    
        st.markdown("---")
        macro_events = load_articles_from_csv("src/macro/events.csv")
        if macro_events:
            st.markdown("#### 저장된 매크로 이벤트")

async def auto_scrape_predefined_stocks():
    """정의된 종목들에 대해 자동으로 최신 뉴스를 스크랩합니다."""
    crawler = RegulationCrawler()
    target_path = "WebScrap/stock_targets.json"
    if not os.path.exists(target_path):
        target_path = os.path.join("WebScrap", "stock_targets.json")
        if not os.path.exists(target_path):
            return
    try:
        with open(target_path, 'r', encoding='utf-8') as f:
            targets = json.load(f).get('targets', [])
    except Exception as e:
        return
        
    status_placeholder = st.empty()
    for target in targets:
        name = target['name']
        ticker = target['ticker']
        status_placeholder.info(f"[{name}] 최신 뉴스 수집 중...")
        await crawler.crawl(query=f"{name} 뉴스", limit=5, filepath=f"src/stocks/{ticker}/articles.csv")
    status_placeholder.empty()
