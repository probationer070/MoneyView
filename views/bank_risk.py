import streamlit as st
import plotly.express as px
import pandas as pd

def render(df):
    st.subheader("은행 가산금리와 '배드뱅크' 리스크")
    st.markdown("**부실 비용 전가로 인한 고신용자 역차별 및 은행 건전성 악화**")

    col1, col2 = st.columns(2)

    with col1:
        # 예대금리차 (가산금리 Proxy)
        st.markdown("##### 1. 예대금리차 (가산금리 추이)")
        loan_rate = df[df['name'].str.contains("대출평균금리")].copy()
        deposit_rate = df[df['name'].str.contains("저축성수신금리")].copy()
        
        if not loan_rate.empty and not deposit_rate.empty:
            merged = pd.merge(loan_rate[['date', 'value']], deposit_rate[['date', 'value']], on='date', suffixes=('_loan', '_dep'))
            merged['spread'] = merged['value_loan'] - merged['value_dep']
            
            fig1 = px.line(merged, x='date', y='spread', title="예대금리차 (신규취급액 기준)", labels={'spread': '차이(%p)'})
            st.plotly_chart(fig1, width="stretch")
        else:
            st.info("대출/수신 금리 데이터가 부족합니다.")

    with col2:
        # 신용등급별 금리 (대기업 vs 중소기업 Proxy)
        st.markdown("##### 2. 대출 금리 격차 (대기업 vs 중소기업)")
        large_corp = df[df['name'].str.contains("대기업대출")].copy()
        sme_corp = df[df['name'].str.contains("중소기업대출")].copy()
        
        if not large_corp.empty and not sme_corp.empty:
            combined = pd.concat([large_corp, sme_corp])
            fig2 = px.line(combined, x='date', y='value', color='name', title="기업 규모별 대출 금리", labels={'value': '금리(%)'})
            st.plotly_chart(fig2, width="stretch")
        else:
            st.info("기업 대출 금리 데이터가 부족합니다.")

    # 법인 파산 및 연체율
    st.markdown("##### 3. 법인 파산 및 건전성 지표")
    risk_data = df[df['category'] == "시스템 리스크"].copy()
    if not risk_data.empty:
        fig3 = px.bar(risk_data, x='date', y='value', color='name', title="시스템 리스크 지표", labels={'value': '건수/비율'})
        st.plotly_chart(fig3, width="stretch")
    else:
        st.info("법인 파산 또는 연체율 데이터가 없습니다.")
