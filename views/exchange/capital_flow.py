import streamlit as st
import plotly.express as px
import pandas as pd
from utils import plot_metric
from functools import reduce

def render(df):
    st.subheader("환율 변동의 책임 소재 및 자금 유출")
    st.markdown("**'서학개미 탓'이 아닌 '외국인 이탈과 통화 정책'이 주범임을 증명**")

    col1, col2 = st.columns(2)
    
    with col1:
        # 거주자 외화예금 및 해외 주식 결제 대금 추이
        st.markdown("##### 1. 거주자 외화예금 & 해외주식 결제")
        forex_dep = df[df['name'].str.contains("거주자 외화예금") | df['name'].str.contains("외화예금")].copy()
        stock_pay = df[df['name'].str.contains("해외주식 결제") | df['name'].str.contains("해외 주식")].copy()
        
        combined_1 = pd.concat([forex_dep, stock_pay])
        if not combined_1.empty:
            fig1 = px.line(combined_1, x='date', y='value', color='name',
                           title="거주자 외화예금 및 해외 주식 자금 이동", labels={'value': '금액'})
            st.plotly_chart(fig1, width="stretch")
        else:
            st.info("거주자 외화예금 또는 해외 주식 결제 데이터가 없습니다.")

    with col2:
        st.markdown("##### 2. 투자자별 순매수 동향")
        
        # 1. 데이터 필터링
        foreign = df[df['name'].str.contains("외국인") & df['name'].str.contains("순매수")].copy()
        institution = df[df['name'].str.contains("기관") & df['name'].str.contains("순매수")].copy()
        individual = df[df['name'].str.contains("개인") & df['name'].str.contains("순매수")].copy()

        # 2. 월별 데이터 집계
        if not foreign.empty and not institution.empty and not individual.empty:
            foreign_monthly = foreign.groupby('date')['value'].sum().reset_index()
            institution_monthly = institution.groupby('date')['value'].sum().reset_index()
            individual_monthly = individual.groupby('date')['value'].sum().reset_index()

            # 3. 데이터 병합
            dfs = [
                foreign_monthly.rename(columns={'value': '외국인'}),
                institution_monthly.rename(columns={'value': '기관'}),
                individual_monthly.rename(columns={'value': '개인'})
            ]
            merged = reduce(lambda left, right: pd.merge(left, right, on='date', how='outer'), dfs).fillna(0)
            
            melted = merged.melt(id_vars=['date'], value_vars=['외국인', '기관', '개인'],
                                 var_name='투자자', value_name='순매수액(십억원)')
            
            fig2 = px.bar(melted, x='date', y='순매수액(십억원)', color='투자자', title="투자자별 순매수 동향")
            fig2.add_hline(y=0, line_dash="dash", line_color="gray")
            st.plotly_chart(fig2, width="stretch")
            st.caption("💡 외국인 순매수(파랑)가 음수(-)이면 자본 유출을 의미합니다.")
        else:
            st.info("투자자별 순매수 데이터(외국인, 기관, 개인) 중 일부가 부족합니다.")

    # 원/달러 환율 vs 주요국 통화 가치 변동률
    st.markdown("##### 3. 원화 vs 주요국 통화 가치 변동률")
    currencies = df[df['name'].str.contains("원/미국달러") | df['name'].str.contains("달러 인덱스") | df['name'].str.contains("엔")].copy()
    
    if not currencies.empty:
        # 정규화 (Normalize to 100)
        currencies['normalized'] = currencies.groupby('name')['value'].transform(lambda x: (x / x.iloc[0]) * 100)
        fig3 = px.line(currencies, x='date', y='normalized', color='name',
                       title="주요 통화 가치 변동률 (Start=100)", labels={'normalized': '변동률 (Base=100)'})
        st.plotly_chart(fig3, width="stretch")
    else:
        st.info("환율 및 주요국 통화 데이터가 없습니다.")