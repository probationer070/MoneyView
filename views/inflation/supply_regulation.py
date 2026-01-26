import streamlit as st
import plotly.express as px
import pandas as pd
from utils import calculate_yoy

def render(df):
    st.subheader("공급측 인플레이션과 규제 리스크")
    st.markdown("**규제가 초래한 공급 위축과 비용 전가형 인플레이션**")

    col1, col2 = st.columns(2)

    with col1:
        # PPI vs CPI (전가율)
        st.markdown("##### 1. 생산자물가(PPI) vs 소비자물가(CPI)")
        # PPI 데이터가 현재 수집 목록에 명시적으로 없으므로 수입물가로 대체 가능성 확인
        ppi = df[df['name'].str.contains("PPI") | df['name'].str.contains("생산자물가") | df['name'].str.contains("수입물가")].copy()
        cpi = calculate_yoy(df, "CPI(총지수)")
        
        if not ppi.empty and not cpi.empty:
            if "수입물가" in ppi['name'].iloc[0]:
                 ppi = calculate_yoy(df, ppi['name'].iloc[0])
            
            merged = pd.merge(ppi[['date', 'value', 'name']], cpi[['date', 'value']], on='date', suffixes=('_ppi', '_cpi'))
            fig1 = px.line(merged, x='date', y=['value_ppi', 'value'], title="비용(PPI/수입물가) vs 가격(CPI)", labels={'value': '상승률(%)'})
            st.plotly_chart(fig1, width="stretch")
        else:
            st.info("PPI(또는 수입물가) 및 CPI 데이터가 부족합니다.")

    with col2:
        # 엔캐리 자금 흐름 (엔/달러 환율로 Proxy)
        st.markdown("##### 2. 엔캐리 자금 흐름 (엔/달러)")
        yen_usd = df[df['name'].str.contains("일본엔/달러") | df['name'].str.contains("엔")].copy()
        
        if not yen_usd.empty:
            fig2 = px.line(yen_usd, x='date', y='value', title="엔화 환율 추이", labels={'value': '환율'})
            st.plotly_chart(fig2, width="stretch")
        else:
            st.info("엔화 환율 데이터가 없습니다.")