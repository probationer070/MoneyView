import streamlit as st
import plotly.express as px
import pandas as pd

def render(df):
    st.subheader("외환 및 대외 건전성")
    st.markdown("**환율 1,450원 돌파와 외환보유고 고갈 리스크 모니터링**")
    
    col1, col2 = st.columns(2)
    with col1:
        # 외환보유액 구성 (현금 vs 유가증권)
        reserves = df[df['name'].str.contains("외환보유액")].copy()
        if not reserves.empty:
            fig_res = px.line(reserves, x='date', y='value', color='name',
                              title="외환보유액 구성 (유동성 확인)", labels={'value': '천달러'})
            st.plotly_chart(fig_res, width="stretch")
            st.caption("💡 위기 시 즉시 쓸 수 있는 '예치금(Deposits)' 비중이 중요합니다.")
            
    with col2:
        # CDS 프리미엄 (InvestpyCollector로 수집됨)
        cds_kr = df[df['name'].str.contains("5년물 CDS") | df['name'].str.contains("CDS 프리미엄")].copy()
        
        if not cds_kr.empty:
            fig_cds = px.line(cds_kr, x='date', y='value', color='name',
                              title="한국 5년물 CDS 프리미엄", labels={'value': 'bp (Basic Point)'})
            st.plotly_chart(fig_cds, width="stretch")
            st.caption("💡 외국 자본 이탈 위험 및 부도 위험을 나타내는 핵심 지표입니다.")
        else:
            # Fallback
            st.info("CDS 프리미엄 관련 데이터가 없습니다.")