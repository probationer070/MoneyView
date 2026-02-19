import streamlit as st
import plotly.express as px
import pandas as pd
from utils import plot_metric, calculate_yoy

def render(df):
    st.subheader("재무 관리 능력의 허구성과 세금 전가")
    st.markdown("**'장기투자/자산가' 프레임 뒤의 실체와 청년 세대의 노동 가치 훼손**")

    col1, col2 = st.columns(2)

    with col1:
        # 연령대별 자산 구성비 TODO: No Data
        st.markdown("##### 1. 연령대별 자산 구성 (부동산 vs 금융)")
        asset_comp = df[df['name'].str.contains("자산 구성") | df['name'].str.contains("연령별 자산")].copy()
        
        if not asset_comp.empty:
            # 최신 데이터 기준 파이차트 또는 바차트
            latest_date = asset_comp['date'].max()
            latest_data = asset_comp[asset_comp['date'] == latest_date]
            fig1 = px.pie(latest_data, values='value', names='name', title=f"자산 구성비 ({latest_date})")
            st.plotly_chart(fig1, width="stretch")
        else:
            st.info("연령대별 자산 구성 데이터가 없습니다.")

    with col2:
        # 사회보험료 인상 추이 TODO: No Data
        st.markdown("##### 2. 사회보험료(국민연금/건강보험) 요율")
        insurance = df[df['name'].str.contains("국민연금") | df['name'].str.contains("건강보험") | df['name'].str.contains("보험료")].copy()
        
        if not insurance.empty:
            fig2 = px.line(insurance, x='date', y='value', color='name', markers=True,
                           title="사회보험료 요율 인상 추이", labels={'value': '요율(%)'})
            st.plotly_chart(fig2, width="stretch")
        else:
            st.info("사회보험료 요율 데이터가 없습니다.")

    # 물가 상승률 vs 실질 임금 상승률
    st.markdown("##### 3. 물가(CPI) vs 실질 임금 상승률 (노동 가치 훼손)")
    cpi_yoy = calculate_yoy(df, "CPI(총지수)")
    wage_growth = df[df['name'].str.contains("임금상승률") | df['name'].str.contains("실질임금")].copy()
    
    combined_3 = pd.concat([cpi_yoy, wage_growth])
    
    if not combined_3.empty:
        fig3 = px.line(combined_3, x='date', y='value', color='name',
                       title="물가 상승률 vs 실질 임금 상승률", labels={'value': '상승률(%)'})
        # 0% 기준선
        fig3.add_hline(y=0, line_dash="dash", line_color="gray")
        st.plotly_chart(fig3, width="stretch")
        st.caption("💡 물가 상승률이 임금 상승률보다 높으면 실질 소득은 감소(마이너스)하는 것입니다.")
    else:
        st.info("CPI 또는 임금 상승률 데이터가 부족합니다.")