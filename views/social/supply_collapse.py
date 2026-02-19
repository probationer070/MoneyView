import streamlit as st
import plotly.express as px
import pandas as pd

def render(df):
    st.subheader("공공 주급 체계의 붕괴 및 병목 데이터")
    st.markdown("**LH/HUG 부실로 인한 공급 절벽과 청약 무용론의 근거**")

    col1, col2 = st.columns(2)

    with col1:
        # LH/HUG 부채 관련 (데이터 부재 시 안내) TODO: No Data
        st.markdown("##### 1. LH/HUG 재무 건전성")
        public_debt = df[df['name'].str.contains("LH") | df['name'].str.contains("HUG")].copy()
        
        if not public_debt.empty:
            fig1 = px.bar(public_debt, x='date', y='value', color='name', title="공공 주택 기관 부채/대위변제", labels={'value': '금액'})
            st.plotly_chart(fig1, width="stretch")
        else:
            st.info("LH/HUG 부채 데이터가 없습니다. (별도 수집 필요)")

    with col2:
        # 주택 인허가/착공 (데이터 부재 시 안내) TODO: No Data
        st.markdown("##### 2. 주택 인허가 및 착공 실적")
        housing_supply = df[df['name'].str.contains("인허가") | df['name'].str.contains("착공")].copy()
        
        if not housing_supply.empty:
            fig2 = px.line(housing_supply, x='date', y='value', color='name', title="주택 공급 선행 지표", labels={'value': '호'})
            st.plotly_chart(fig2, width="stretch")
        else:
            st.info("주택 인허가/착공 데이터가 없습니다.")
            
    st.caption("💡 공급 절벽은 2~3년 뒤 입주 물량 부족으로 이어져 주거 비용 상승을 유발합니다.")
