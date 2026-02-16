import streamlit as st
import plotly.express as px
import pandas as pd
from utils import plot_metric

def render(df):
    st.subheader("비용 전가 및 인플레이션 구조")
    st.markdown("**'환율 상승 → 원자재/임대료 상승 → X·86 이익' 구조 시각화**")

    col1, col2 = st.columns(2)

    with col1:
        # 원자재 수입 물가 지수 및 공공요금
        st.markdown("##### 1. 수입 물가 & 공공요금(전기/가스)")
        import_price = df[df['name'].str.contains("수입물가") | df['name'].str.contains("원자재")].copy()
        utility_price = df[df['name'].str.contains("전기") | df['name'].str.contains("가스") | df['name'].str.contains("공공요금")].copy()
        
        combined_1 = pd.concat([import_price, utility_price])
        if not combined_1.empty:
            fig1 = px.line(combined_1, x='date', y='value', color='name',
                           title="원자재 수입 물가 및 공공요금 추이", labels={'value': '지수/가격'})
            st.plotly_chart(fig1, use_container_width=True)
        else:
            st.info("수입 물가 또는 공공요금 데이터가 없습니다.")

    with col2:
        # 부동산 임대료 추이
        st.markdown("##### 2. 부동산 임대료 & 임대소득 비중")
        rent_trend = df[df['name'].str.contains("임대료") | df['name'].str.contains("전세") | df['name'].str.contains("월세")].copy()
        
        if not rent_trend.empty:
            fig2 = px.line(rent_trend, x='date', y='value', color='name',
                           title="부동산 임대료 추이", labels={'value': '가격지수'})
            st.plotly_chart(fig2, use_container_width=True)
        else:
            st.info("부동산 임대료 관련 데이터가 없습니다.")

    # 사회적 비용 (최저임금 등)
    st.markdown("##### 3. 사회적 비용 (최저임금/정년연장)")
    social_cost = df[df['name'].str.contains("최저임금") | df['name'].str.contains("사회보험")].copy()
    
    if not social_cost.empty:
        fig3 = px.bar(social_cost, x='date', y='value', color='name',
                      title="최저임금 및 사회적 비용 증가 추이", labels={'value': '금액/비율'})
        st.plotly_chart(fig3, use_container_width=True)
    else:
        plot_metric(df, "임금", "임금 및 사회적 비용 데이터")
        st.caption("💡 최저임금 및 정년 연장 관련 비용 데이터가 수집되면 이곳에 표시됩니다.")