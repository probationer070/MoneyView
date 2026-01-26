import streamlit as st
import plotly.express as px
import pandas as pd
from utils import calculate_yoy

def render(df):
    st.subheader("공공 자금의 시장 개입 및 부채 전가")
    st.markdown("**'국민연금 동원'과 '국채 발행'이 청년 세대의 미래 가치를 어떻게 잠식하는지 시각화**")

    col1, col2 = st.columns(2)
    
    with col1:
        # 국민연금 국내 주식 순매수 (데이터 부재 시 안내)
        st.markdown("##### 1. 국민연금 국내 주식 순매수 추이")
        nps_buying = df[df['name'].str.contains("국민연금") & df['name'].str.contains("순매수")].copy()
        
        if not nps_buying.empty:
            fig1 = px.bar(nps_buying, x='date', y='value', title="국민연금 코스피 순매수", labels={'value': '금액'})
            st.plotly_chart(fig1, width="stretch")
        else:
            st.info("국민연금 순매수 데이터가 없습니다. (수집 필요)")

    with col2:
        # 국가 채무 및 이자 부담 (국고채 금리로 시뮬레이션)
        st.markdown("##### 2. 국채 금리 상승에 따른 이자 부담")
        gov_bond = df[df['name'].str.contains("국고채") & df['name'].str.contains("10년")].copy()
        
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
    m2_yoy = calculate_yoy(df, "M2(평잔)")
    cpi_yoy = calculate_yoy(df, "CPI(총지수)")
    
    if not m2_yoy.empty and not cpi_yoy.empty:
        # 데이터 병합
        merged = pd.merge(m2_yoy[['date', 'value']], cpi_yoy[['date', 'value']], on='date', suffixes=('_m2', '_cpi'))
        
        fig3 = px.line(merged, x='date', y=['value_m2', 'value_cpi'], 
                       title="M2 증가율 vs CPI 상승률", labels={'value': '증가율(%)', 'variable': '지표'})
        st.plotly_chart(fig3, width="stretch")
        st.caption("💡 통화량이 물가보다 빠르게 늘어나면 화폐 가치는 하락합니다.")
    else:
        st.info("M2 또는 CPI 데이터가 부족합니다.")
