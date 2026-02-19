import streamlit as st
import pandas as pd
import plotly.express as px
from WebScrap.Crawler.RegulationCrawler import RegulationCrawler

def render(df):
    st.subheader("금융 억압 및 자본 통제 지표")
    st.markdown("**정부의 인위적인 자본 유출 방어 및 민간 통제 시도**")

    col1, col2 = st.columns(2)

    with col1:
        # 기업 외화 환전 비율 (데이터 부재 시 안내)
        st.markdown("##### 1. 기업 외화 예금/환전 동향")
        corp_forex = df[df['name'].str.contains("거주자 외화예금")].copy() # 대용 지표
        
        if not corp_forex.empty:
            st.line_chart(corp_forex.set_index('date')['value'])
            st.caption("💡 거주자 외화예금 증가는 환전 유보(달러 보유) 심리를 나타냅니다.")
        else:
            st.info("외화 예금 데이터가 없습니다.")

    # TODO: 데이터 크롤링 필요
    with col2: 
        # 해외 송금/투자 규제 뉴스 (Google News RSS 활용)
        st.markdown("##### 2. 자본 통제 관련 뉴스/규제 (Google News)")
        
        # 검색 기능 추가
        search_keyword = st.text_input("키워드 검색", placeholder="예: 해외 송금, 자본 통제")
        
        if st.button("뉴스 검색"):
            if search_keyword:
                with st.spinner(f"'{search_keyword}' 관련 뉴스 검색 중..."):
                    crawler = RegulationCrawler()
                    news_list = crawler.crawl(query=search_keyword, limit=10)
                    
                    if news_list:
                        for news in news_list:
                            # 날짜 포맷 정리 (Tue, 03 Dec 2024 ... -> 앞부분만)
                            display_date = news.date[:16] if len(news.date) > 16 else news.date
                            st.markdown(f"- **[{display_date}]** [{news.title}]({news.url})")
                    else:
                        st.warning("검색 결과가 없습니다.")
            else:
                st.warning("검색어를 입력해주세요.")
        else:
            st.info("키워드를 입력하고 검색하면 구글 뉴스 RSS 결과를 보여줍니다.")
        
    # 해외 투자 자금 추이
    st.markdown("##### 3. 해외 투자 자금 추이 (직접/증권)")
    securities_inv = df[df['name'] == "증권투자"].copy()
    direct_inv = df[df['name'] == "직접투자"].copy()

    combined_inv = pd.concat([securities_inv, direct_inv])

    if not combined_inv.empty:
        fig3 = px.line(combined_inv, x='date', y='value', color='name',
                       title="해외 직접투자 및 증권투자 추이",
                       labels={'value': '금액(백만달러)', 'date': '날짜', 'name': '투자 유형'})
        st.plotly_chart(fig3, width="stretch")
        st.caption("💡 국제투자대조표 기준 해외 직접투자 및 증권투자 잔액 추이입니다.")
    else:
        st.info("해외 직접투자 또는 증권투자 데이터가 없습니다.")