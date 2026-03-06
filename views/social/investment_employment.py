import streamlit as st
import pandas as pd
from WebScrap.Crawler.RegulationCrawler import RegulationCrawler

def render(df):
    st.subheader("투자 및 고용 동향 (Investment & Employment)")
    st.markdown("> **\"재정 지출과 시장 금리가 벤처 생태계 및 채용 시장에 미치는 영향\"**")
    
    crawler = RegulationCrawler()
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.markdown("##### 1. VC 및 스타트업 펀딩 규모")
        st.caption("관련 뉴스 기사 스크랩")
        
        with st.spinner("뉴스 검색 중..."):
            news_list1 = crawler.crawl(query="스타트업 펀딩 투자 유치", limit=5)
            
        if news_list1:
            for news in news_list1:
                st.markdown(f"- [{news.title}]({news.url}) <span style='color:gray; font-size:0.8em;'>({news.date[:10]})</span>", unsafe_allow_html=True)
        else:
            st.info("검색된 뉴스가 없습니다.")

    with col2:
        st.markdown("##### 2. 주요 기업 채용 공고 수")
        st.caption("관련 뉴스 기사 스크랩")
        
        with st.spinner("뉴스 검색 중..."):
            news_list2 = crawler.crawl(query="기업 채용 공고 감소", limit=5)
            
        if news_list2:
            for news in news_list2:
                st.markdown(f"- [{news.title}]({news.url}) <span style='color:gray; font-size:0.8em;'>({news.date[:10]})</span>", unsafe_allow_html=True)
        else:
            st.info("검색된 뉴스가 없습니다.")
            
    st.markdown("---")
    st.markdown("##### 3. 재정 지출과 시장 금리 상관관계")
    fiscal_spend = df[df['name'].str.contains("통합재정수지")].copy()
    market_rate = df[df['name'].str.contains("국고채\(3년\)")].copy()
    
    if not fiscal_spend.empty and not market_rate.empty:
        merged = pd.merge(fiscal_spend[['date', 'value']], market_rate[['date', 'value']], on='date', how='outer', suffixes=('_fiscal', '_rate'))
        merged = merged.sort_values('date').ffill().dropna()
        
        import plotly.graph_objects as go
        from plotly.subplots import make_subplots
        fig3 = make_subplots(specs=[[{"secondary_y": True}]])
        fig3.add_trace(go.Bar(x=merged['date'], y=merged['value_fiscal'], name="통합재정수지", marker_color='red'), secondary_y=False)
        fig3.add_trace(go.Scatter(x=merged['date'], y=merged['value_rate'], name="국고채 3년물 금리", mode='lines', line_color='blue'), secondary_y=True)
        fig3.update_layout(title="재정 적자와 금리의 관계")
        fig3.update_yaxes(title_text="재정 수지 (십억원)", secondary_y=False)
        fig3.update_yaxes(title_text="금리 (%)", secondary_y=True)
        st.plotly_chart(fig3, width="stretch")
        st.caption("💡 적자 재정을 메우기 위한 국채 발행은 시중 자금을 흡수하여 시장 금리를 올릴 수 있습니다 (구축 효과).")
    else:
        st.info("재정 지출 또는 시장 금리 데이터가 부족합니다.")
