import streamlit as st
import plotly.express as px
import pandas as pd
from WebScrap.Crawler.RegulationCrawler import RegulationCrawler
from utils import plot_metric

def render(df):
    st.subheader("은행 신용 및 예대마진 (Banking & Credit)")
    st.markdown("> **\"가계 대출, COFIX, 그리고 은행의 예대마진 추이\"**")
    
    crawler = RegulationCrawler()
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.markdown("##### 1. COFIX 및 은행 조달비용 동향")
        st.caption("관련 뉴스 기사 스크랩")
        
        with st.spinner("뉴스 검색 중..."):
            news_list1 = crawler.crawl(query="COFIX 은행 조달비용 상승", limit=5)
            
        if news_list1:
            for news in news_list1:
                st.markdown(f"- [{news.title}]({news.url}) <span style='color:gray; font-size:0.8em;'>({news.date[:10]})</span>", unsafe_allow_html=True)
        else:
            st.info("검색된 뉴스가 없습니다.")

    with col2:
        st.markdown("##### 2. 은행 예대금리차 (가계대출 - 저축수신)")
        loan_rate = df[df['name'].str.contains("가계대출금리\(신규\)")].copy()
        deposit_rate = df[df['name'].str.contains("저축성수신금리\(신규\)")].copy()
        
        if not loan_rate.empty and not deposit_rate.empty:
            merged_spread = pd.merge(loan_rate[['date', 'value']], deposit_rate[['date', 'value']], on='date', how='outer', suffixes=('_loan', '_dep'))
            merged_spread = merged_spread.sort_values('date').ffill().dropna()
            
            merged_spread['Spread(Net Interest Margin)'] = merged_spread['value_loan'] - merged_spread['value_dep']
            
            fig2 = px.bar(merged_spread, x='date', y='Spread(Net Interest Margin)',
                          title="예대금리차 (은행 마진 구조)",
                          labels={'Spread(Net Interest Margin)': '예대금리차(%p)'},
                          color='Spread(Net Interest Margin)', color_continuous_scale='Blues')
                          
            # 추세선 추가
            fig2.add_scatter(x=merged_spread['date'], y=merged_spread['Spread(Net Interest Margin)'], mode='lines', name='Spread Trend', line=dict(color='darkblue'))
            
            st.plotly_chart(fig2, width="stretch")
        else:
            st.info("가계대출금리 또는 수신금리 데이터가 없습니다.")
            
    st.markdown("---")
    st.markdown("💡 **인사이트**: 기준금리가 내려가도 가산금리(Add-on)나 예대마진이 넓어지면, 실물 경제(차주)의 이자 부담은 줄어들지 않고 은행의 이익만 극대화됩니다.")
