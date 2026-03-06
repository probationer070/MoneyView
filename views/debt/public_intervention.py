import streamlit as st
import plotly.express as px
import pandas as pd
from utils import calculate_mom
from WebScrap.Crawler.RegulationCrawler import RegulationCrawler

def render(df):
    st.subheader("공공 자금의 시장 개입 및 부채 전가")
    st.markdown("**'국민연금 동원'과 '국채 발행'이 청년 세대의 미래 가치를 어떻게 잠식하는지 시각화**")

    col1, col2 = st.columns(2)
    
    with col1:
        st.markdown("##### 1. 공공 부채 및 연금 관련 뉴스")
        
        # 검색 기능 (기본 키워드: 국민연금 국채)
        search_keyword = st.text_input("키워드 검색", value="국민연금 국채", key="public_news_search")
        
        if st.button("뉴스 검색", key="public_news_btn"):
            if search_keyword:
                with st.spinner(f"'{search_keyword}' 관련 뉴스 검색 중..."):
                    crawler = RegulationCrawler()
                    news_list = crawler.crawl(query=search_keyword)
                    
                    if news_list:
                        for news in news_list:
                            # 날짜 포맷 정리
                            display_date = news.date[:16] if len(news.date) > 16 else news.date
                            st.markdown(f"- **[{display_date}]** [{news.title}]({news.url})")
                    else:
                        st.warning("검색 결과가 없습니다.")
            else:
                st.warning("검색어를 입력해주세요.")
        else:
            st.info("키워드를 입력하고 검색하면 구글 뉴스 RSS 결과를 보여줍니다.")

    with col2:
        # 국가 채무 및 이자 부담 (국고채 금리로 시뮬레이션)
        st.markdown("##### 2. 국채 금리 상승에 따른 이자 부담")
        gov_bond = df[df['name'].str.contains("국고채") & df['name'].str.contains("3년")].copy()
        
        if not gov_bond.empty:
            # 가상의 부채 규모(예: 1000조)에 대한 이자 비용 시뮬레이션
            gov_bond['interest_burden'] = gov_bond['value'] * 10000 # 1000조 * 금리(%) * 0.01 * 단위조정
            fig2 = px.line(gov_bond, x='date', y='value', title="국고채 10년물 금리 추이 (이자 부담 지표)", labels={'value': '금리(%)'})
            st.plotly_chart(fig2, width="stretch")
            st.caption("💡 국채 금리가 오르면 미래 세대가 갚아야 할 이자 비용이 기하급수적으로 늘어납니다.")
        else:
            st.info("국고채 금리 데이터가 없습니다.")

    # 통화량(M2) vs 실질 구매력
    st.markdown("##### 3. 통화량(M2) 증가율 vs 실질 구매력")
    m2_yoy = calculate_mom(df, "M2(평잔)M")
    cpi_yoy = calculate_mom(df, "CPI한국")
    
    if not m2_yoy.empty and not cpi_yoy.empty:
        # 데이터 병합 (최신 데이터 유지를 위해 outer join 후 ffill)
        merged = pd.merge(m2_yoy[['date', 'value']], cpi_yoy[['date', 'value']], on='date', how='outer', suffixes=('_m2', '_cpi'))
        merged = merged.sort_values('date').ffill().dropna()
        
        # 구매력 하락 압력 (초과 유동성) 계산
        merged['초과 유동성(M2증가율 - CPI증가율)'] = merged['value_m2'] - merged['value_cpi']
        
        # 그래프를 더 직관적으로 표현 (Barmode 활용)
        fig3 = px.bar(merged, x='date', y='초과 유동성(M2증가율 - CPI증가율)', 
                       title="초과 유동성 (M2 증가율 - CPI 상승률) = 실질 구매력 하락 압력",
                       labels={'초과 유동성(M2증가율 - CPI증가율)': 'Gap(%)', 'date': '날짜'},
                       color='초과 유동성(M2증가율 - CPI증가율)', color_continuous_scale='Reds')
        
        # 라인 추가 (M2, CPI)
        fig3.add_scatter(x=merged['date'], y=merged['value_m2'], mode='lines', name='M2 증가율(%)', line=dict(color='blue'))
        fig3.add_scatter(x=merged['date'], y=merged['value_cpi'], mode='lines', name='CPI 상승률(%)', line=dict(color='orange'))
        
        st.plotly_chart(fig3, width="stretch")
        st.caption("💡 빨간 막대(초과 유동성)가 양수(+)로 높을수록 시중에 돈이 실물 경제보다 빠르게 풀려 화폐 가치(구매력)가 하락하고 있음을 뜻합니다.")
    else:
        st.info("M2 또는 CPI 데이터가 부족합니다.")
