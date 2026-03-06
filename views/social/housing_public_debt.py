import streamlit as st
import pandas as pd
from WebScrap.Crawler.RegulationCrawler import RegulationCrawler

def render(df):
    st.subheader("주택 공급 절벽 및 공공 부채 (Housing & Public Debt)")
    st.markdown("> **\"인허가 및 착공 실적과 LH/HUG 재무 건전성이 시사하는 공급 절벽 위기\"**")
    
    crawler = RegulationCrawler()
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.markdown("##### 1. 주택 인허가 및 착공 실적")
        st.caption("관련 뉴스 기사 스크랩")
        
        with st.spinner("뉴스 검색 중..."):
            news_list1 = crawler.crawl(query="주택 인허가 착공 감소", limit=5)
            
        if news_list1:
            for news in news_list1:
                st.markdown(f"- [{news.title}]({news.url}) <span style='color:gray; font-size:0.8em;'>({news.date[:10]})</span>", unsafe_allow_html=True)
        else:
            st.info("검색된 뉴스가 없습니다.")

    with col2:
        st.markdown("##### 2. LH(한국토지주택공사) 및 HUG 재무 건전성")
        st.caption("관련 뉴스 기사 스크랩")
        
        with st.spinner("뉴스 검색 중..."):
            news_list2 = crawler.crawl(query="LH HUG 재무건전성 악화", limit=5)
            
        if news_list2:
            for news in news_list2:
                st.markdown(f"- [{news.title}]({news.url}) <span style='color:gray; font-size:0.8em;'>({news.date[:10]})</span>", unsafe_allow_html=True)
        else:
            st.info("검색된 뉴스가 없습니다.")
            
    st.markdown("---")
    st.markdown("💡 **인사이트**: 주택 착공이 급감하는 가운데 PF 문제로 LH/HUG가 공공주도로 공급을 감당하기 어려운 구조라면, 시차를 두고 공급 부족발 집값 불안 요인이 될 수 있습니다.")
