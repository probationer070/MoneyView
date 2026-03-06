import streamlit as st
import pandas as pd
from WebScrap.Crawler.RegulationCrawler import RegulationCrawler

def render(df):
    st.subheader("실질 사회적 비용 추이 (Real Social Cost)")
    st.markdown("> **\"명목 임금 인상보다 더 빠르게 증가하는 4대 보험과 필수 준조세\"**")
    
    crawler = RegulationCrawler()
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.markdown("##### 1. 최저임금 vs 사회보험료(건강/연금) 인상률")
        st.caption("관련 뉴스 기사 스크랩")
        
        with st.spinner("뉴스 검색 중..."):
            news_list1 = crawler.crawl(query="최저임금 건강보험료 인상", limit=5)
            
        if news_list1:
            for news in news_list1:
                st.markdown(f"- [{news.title}]({news.url}) <span style='color:gray; font-size:0.8em;'>({news.date[:10]})</span>", unsafe_allow_html=True)
        else:
            st.info("검색된 뉴스가 없습니다.")

    with col2:
        st.markdown("##### 2. 실질 가처분 소득 감소분")
        st.caption("관련 뉴스 기사 스크랩")
        
        with st.spinner("뉴스 검색 중..."):
            news_list2 = crawler.crawl(query="가처분 소득 하락", limit=5)
            
        if news_list2:
            for news in news_list2:
                st.markdown(f"- [{news.title}]({news.url}) <span style='color:gray; font-size:0.8em;'>({news.date[:10]})</span>", unsafe_allow_html=True)
        else:
            st.info("검색된 뉴스가 없습니다.")
    
    st.markdown("---")
    st.markdown("💡 **인사이트**: 명목 임금이 상승하더라도 4대 보험료 등 준조세 성격의 비용이 더 크게 늘어나면 기업의 고용 축소 및 개인의 실질 가처분 소득 하락으로 이어집니다.")
