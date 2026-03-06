import streamlit as st
import plotly.express as px
import pandas as pd
from utils import plot_metric

def render(df):
    st.subheader("비용 전가 및 인플레이션 구조")
    st.markdown("**'환율 상승 → 원자재/임대료 상승 → X·86 이익' 구조 시각화**")

    col1, col2 = st.columns(2)

    with col1:
        # 공공요금(전기/가스)
        st.markdown("##### 1. 공공요금(전기/가스)")
        utility_price = df[df['name'].str.contains("전기") | df['name'].str.contains("가스") | df['name'].str.contains("공공요금")].copy()
        
        if not utility_price.empty:
            fig1 = px.line(utility_price, x='date', y='value', color='name',
                           title="공공요금 추이", labels={'value': '지수/가격'})
            st.plotly_chart(fig1, width="stretch")
        else:
            st.info("수입 물가 또는 공공요금 데이터가 없습니다.")

    with col2:
        # 부동산 임대료 추이
        st.markdown("##### 2. 부동산 임대료 & 임대소득 비중")
        rent_trend = df[df['name'].str.contains("임대료") | df['name'].str.contains("전세") | df['name'].str.contains("월세")].copy()
        
        if not rent_trend.empty:
            fig2 = px.line(rent_trend, x='date', y='value', color='name',
                           title="부동산 임대료 추이", labels={'value': '가격지수'})
            st.plotly_chart(fig2, width="stretch")
        else:
            st.info("부동산 임대료 관련 데이터가 없습니다.")