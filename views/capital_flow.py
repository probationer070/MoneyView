import streamlit as st
import plotly.express as px
import pandas as pd
from utils import plot_metric

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
        # 외국인 자금의 국가별 이동 (한국 vs 일본)
        st.markdown("##### 2. 외국인 자금 이동 (Korea vs Japan)")
        foreign_kr = df[df['name'].str.contains("외국인 순매수") & df['name'].str.contains("코스피")].copy()
        foreign_jp = df[df['name'].str.contains("외국인 순매수") & (df['name'].str.contains("닛케이") | df['name'].str.contains("일본"))].copy()
        
        combined_2 = pd.concat([foreign_kr, foreign_jp])
        if not combined_2.empty:
            fig2 = px.bar(combined_2, x='date', y='value', color='name', barmode='group',
                          title="외국인 순매수 비교 (코스피 vs 닛케이)", labels={'value': '순매수 대금'})
            st.plotly_chart(fig2, width="stretch")
            st.caption("💡 신뢰도 격차를 보여주는 외국인 자금의 흐름입니다.")
        else:
            st.info("외국인 순매수(코스피/닛케이) 데이터가 없습니다.")

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