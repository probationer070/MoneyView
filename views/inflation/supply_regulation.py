import streamlit as st
import plotly.express as px
import pandas as pd
from utils import calculate_mom

def render(df):
    st.subheader("공급측 인플레이션과 규제 리스크")
    st.markdown("**규제가 초래한 공급 위축과 비용 전가형 인플레이션**")

    col1, col2 = st.columns(2)

    with col1:
        st.markdown("##### 1. 한국 생산자물가(PPI) vs 소비자물가(CPI)")
        kr_ppi_df = df[df['name'].str.contains("PPI") & df['name'].str.contains("한국")].copy()
        kr_cpi_df = df[df['name'] == "CPI한국"].copy()

        if not kr_ppi_df.empty and not kr_cpi_df.empty:
            kr_ppi_name = kr_ppi_df['name'].iloc[0]
            kr_cpi_name = kr_cpi_df['name'].iloc[0]

            kr_ppi_mom = calculate_mom(df, kr_ppi_name)
            kr_cpi_mom = calculate_mom(df, kr_cpi_name)

            if not kr_ppi_mom.empty and not kr_cpi_mom.empty:
                merged_kr = pd.merge(kr_ppi_mom[['date', 'value']], kr_cpi_mom[['date', 'value']], on='date', how='inner', suffixes=('_ppi', '_cpi'))
                merged_kr.rename(columns={'value_ppi': f'{kr_ppi_name} (MoM %)', 'value_cpi': f'{kr_cpi_name} (MoM %)'}, inplace=True)
                
                fig_kr = px.line(merged_kr, x='date', y=merged_kr.columns.drop('date'), 
                                 title="한국 PPI vs CPI (월별 증감률)",
                                 labels={'value': '증감률(%)', 'variable': '지표'})
                st.plotly_chart(fig_kr, width="stretch")
            else:
                st.info("한국 PPI 또는 CPI의 월별 증감률 계산에 실패했습니다.")
        else:
            st.info("한국 PPI 또는 CPI 데이터가 부족합니다.")

    with col2:
        st.markdown("##### 2. 미국 생산자물가(PPI) vs 소비자물가(CPI)")
        us_ppi_df = df[df['name'].str.contains("PPI") & df['name'].str.contains("미국")].copy()
        us_cpi_df = df[df['name'] == "미국 CPI"].copy()

        if not us_ppi_df.empty and not us_cpi_df.empty:
            us_ppi_name = us_ppi_df['name'].iloc[0]
            us_cpi_name = us_cpi_df['name'].iloc[0]

            us_ppi_mom = calculate_mom(df, us_ppi_name)
            us_cpi_mom = calculate_mom(df, us_cpi_name)

            if not us_ppi_mom.empty and not us_cpi_mom.empty:
                merged_us = pd.merge(us_ppi_mom[['date', 'value']], us_cpi_mom[['date', 'value']], on='date', how='inner', suffixes=('_ppi', '_cpi'))
                merged_us.rename(columns={'value_ppi': f'{us_ppi_name} (MoM %)', 'value_cpi': f'{us_cpi_name} (MoM %)'}, inplace=True)

                fig_us = px.line(merged_us, x='date', y=merged_us.columns.drop('date'), 
                                 title="미국 PPI vs CPI (월별 증감률)",
                                 labels={'value': '증감률(%)', 'variable': '지표'})
                st.plotly_chart(fig_us, width="stretch")
            else:
                st.info("미국 PPI 또는 CPI의 월별 증감률 계산에 실패했습니다.")
        else:
            st.info("미국 PPI 또는 CPI 데이터가 부족합니다.")

    # 엔캐리 자금 흐름 (엔/달러 환율로 Proxy)   TODO: 이에 대해 자세한 조사필요
    st.markdown("##### 3. 엔캐리 자금 흐름 (엔/달러)")
    yen_usd = df[df['name'].str.contains("일본엔/달러") | (df['name'].str.contains("엔") & ~df['name'].str.contains("국채"))].copy()
        
    if not yen_usd.empty:
        fig_yen = px.line(yen_usd, x='date', y='value', color='name', title="엔화 관련 환율 추이", labels={'value': '환율'})
        st.plotly_chart(fig_yen, width="stretch")
        st.caption("💡 엔화 가치 변동은 글로벌 자금 흐름(엔캐리 트레이드)에 영향을 줄 수 있습니다.")
    else:
        st.info("엔화 환율 데이터가 없습니다.")