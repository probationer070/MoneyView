import streamlit as st
import plotly.express as px
import pandas as pd
from utils import calculate_yoy

def render(df):
    st.subheader("인플레이션의 본질 (Inflation Mechanics)")
    st.markdown("> **\"주가가 올라 M2가 늘어난 것이 아니라, M2가 늘어 주가가 오른 것이다.\"**")
    
    # 1. M2 증가율 vs CPI (시차 상관관계)
    m2_growth = calculate_yoy(df, "M2(평잔)")
    cpi_growth = calculate_yoy(df, "CPI(총지수)")
    
    if not m2_growth.empty and not cpi_growth.empty:
        # 데이터 병합
        merged_inf = pd.merge(m2_growth[['date', 'value']], cpi_growth[['date', 'value']], on='date', suffixes=('_M2', '_CPI'))
        
        fig_inf = px.line(merged_inf, x='date', y=['value_M2', 'value_CPI'], 
                          title="통화량 공급(M2)과 물가(CPI)의 시차 상관관계",
                          labels={'value': '증가율(%)', 'date': '날짜', 'variable': '지표'})
        st.plotly_chart(fig_inf, use_container_width=True)
        st.caption("💡 통화량(M2) 폭증 이후 시차를 두고 소비자물가(CPI)가 따라오는지 확인하십시오.")
    
    # 2. 통화 유통속도 (Velocity of Money) = GDP / M2
    gdp_data = df[df['name'] == "명목GDP"].sort_values('date')
    m2_data = df[df['name'] == "M2(평잔)"].sort_values('date')
    
    if not gdp_data.empty and not m2_data.empty:
        # 분기 데이터와 월간 데이터 매칭 (분기말 기준)
        merged_vel = pd.merge(gdp_data, m2_data, on='date', suffixes=('_GDP', '_M2'), how='inner')
        if not merged_vel.empty:
            merged_vel['velocity'] = merged_vel['value_GDP'] / merged_vel['value_M2']
            fig_vel = px.line(merged_vel, x='date', y='velocity', markers=True,
                              title="통화 유통속도 (Velocity of Money)",
                              labels={'velocity': '유통속도', 'date': '날짜'})
            st.plotly_chart(fig_vel, use_container_width=True)
            st.caption("💡 유통속도가 낮은데 물가가 오른다면 '스태그플레이션' 신호일 수 있습니다.")
    else:
        st.info("통화 유통속도 계산을 위한 데이터(GDP, M2)가 부족합니다.")