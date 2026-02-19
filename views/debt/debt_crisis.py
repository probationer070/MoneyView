import streamlit as st
import plotly.express as px
import pandas as pd
from utils import plot_metric

def render(df):
    st.subheader("국채 금리와 대출 금리의 동조화")
    st.markdown("**정부의 국채 발행 폭주가 주담대 6% 시대를 여는 과정**")

    # 1. 국고채 3년물 (실시간/일별)
    st.markdown("##### 1. 국고채 3년물 금리 (기준점)")
    gov_bond = df[df['name'].str.contains("국고채") & df['name'].str.contains("3년")].copy()
    
    if not gov_bond.empty:
        fig1 = px.line(gov_bond, x='date', y='value', markers=True,
                       title="국고채 3년물 금리 추이", labels={'value': '금리(%)'})
        st.plotly_chart(fig1, width="stretch")
    else:
        st.info("국고채 3년물 데이터가 없습니다.")

    col1, col2 = st.columns(2)
    
    with col1:
        # COFIX 지수 TODO: No Data
        st.markdown("##### 2. COFIX 지수 (은행 조달 비용)")
        cofix = df[df['name'].str.contains("COFIX") | df['name'].str.contains("코픽스")].copy()
        
        if not cofix.empty:
            fig2 = px.line(cofix, x='date', y='value', markers=True,
                           title="신규취급액 기준 COFIX 추이", labels={'value': '지수/금리(%)'})
            st.plotly_chart(fig2, width="stretch")
        else:
            st.info("COFIX 데이터가 없습니다.")

    with col2:
        # 주택담보대출 금리
        st.markdown("##### 3. 주택담보대출 평균 금리 (체감 금리)")
        mortgage = df[df['name'].str.contains("주택담보대출") & df['name'].str.contains("금리")].copy()
        
        if not mortgage.empty:
            fig3 = px.line(mortgage, x='date', y='value', color='name', markers=True,
                           title="주택담보대출 금리 (신규/잔액)", labels={'value': '금리(%)'})
            st.plotly_chart(fig3, width="stretch")
            st.caption("💡 이 수치가 6%대에 진입하면 영끌족의 이자 부담이 임계치를 넘습니다.")
        else:
            st.info("주택담보대출 금리 데이터가 없습니다.")