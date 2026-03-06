import streamlit as st
import plotly.express as px
import pandas as pd

def render(df):
    st.subheader("국채 금리 폭등과 '배급 정책'의 대가")
    st.markdown("**재정 적자가 불러온 금리 급등과 전 국민의 이자 비용 상승**")

    # 1. 국채 3년물 금리 추이
    st.markdown("##### 1. 국고채 3년물 금리 급등 구간")
    gov_bond = df[df['name'].str.contains("국고채") & df['name'].str.contains("3년")].copy()
    
    if not gov_bond.empty:
        fig1 = px.line(gov_bond, x='date', y='value', markers=True, title="국고채 3년물 금리", labels={'value': '금리(%)'})
        st.plotly_chart(fig1, width="stretch")
    else:
        st.info("국고채 3년물 데이터가 없습니다.")

    col1, col2 = st.columns(2)

    with col1:
        # 이자 부담 시뮬레이션 (가상)
        st.markdown("##### 2. 국채 이자 부담액 (시뮬레이션)")
        if not gov_bond.empty:
            # 가정: 국채 잔액 1000조원 가정 시 연간 이자 비용
            gov_bond['interest_cost'] = gov_bond['value'] * 10000 # 1000조 * % * 0.01 * 단위조정
            fig2 = px.area(gov_bond, x='date', y='interest_cost', title="이자 비용 시뮬레이션 (부채 1천조 가정)", labels={'interest_cost': '이자비용(단위)'})
            st.plotly_chart(fig2, width="stretch")
        else:
            st.info("데이터 부족")

    with col2:
        # 구축 효과 (국채 금리 vs 대출 금리)
        st.markdown("##### 3. 구축 효과 (Crowding-out)")
        loan_rate = df[df['name'].str.contains("대출평균금리")].copy()
        if not gov_bond.empty and not loan_rate.empty:
            merged = pd.merge(gov_bond[['date', 'value']], loan_rate[['date', 'value']], on='date', how='outer', suffixes=('_bond', '_loan'))
            merged = merged.sort_values('date').ffill().dropna()
            fig3 = px.line(merged, x='date', y=['value_bond', 'value_loan'], title="국채 금리 vs 대출 금리", labels={'value': '금리(%)'})
            st.plotly_chart(fig3, width="stretch")
        else:
            st.info("대출 금리 데이터가 부족합니다.")