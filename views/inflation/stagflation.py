import streamlit as st
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import pandas as pd
from functools import reduce
from utils import calculate_yoy

def render(df):
    st.subheader("쌍둥이 적자와 스태그플레이션")
    st.markdown("**재정/무역 적자와 3고(고물가·고금리·고환율) 현상**")

    col1, col2 = st.columns(2)

    with col1:
        # 쌍둥이 적자 (무역수지 + 재정수지) - 데이터 확인 필요
        st.markdown("##### 1. 무역수지 및 재정수지")
        trade_balance = df[df['name'].str.contains("무역수지") | df['name'].str.contains("경상수지")].copy()
        
        if not trade_balance.empty:
            fig1 = px.bar(trade_balance, x='date', y='value', title="무역/경상수지 추이", labels={'value': '금액'})
            st.plotly_chart(fig1, width="stretch")
        else:
            st.info("무역수지 데이터가 없습니다. (수집 필요)")

    with col2:
        # 3고 현상 (물가, 금리, 환율)
        st.markdown("##### 2. 3고 현상 (물가·금리·환율)")
        
        # 1. 데이터 준비 (CPI는 YoY, 나머지는 월평균)
        cpi_yoy = calculate_yoy(df, "CPI(총지수)")
        rate = df[df['name'].str.contains("국고채") & df['name'].str.contains("3년")].copy()
        ex_rate = df[df['name'].str.contains("원/미국달러")].copy()
        
        dfs = []
        
        if not cpi_yoy.empty:
            cpi_yoy = cpi_yoy[['date', 'value']].rename(columns={'value': 'CPI 상승률(%)'})
            cpi_yoy['date'] = pd.to_datetime(cpi_yoy['date'])
            dfs.append(cpi_yoy)
            
        if not rate.empty:
            rate['date'] = pd.to_datetime(rate['date'])
            # 일별 -> 월별 평균
            rate_m = rate.set_index('date').resample('MS')['value'].mean().reset_index()
            rate_m.rename(columns={'value': '국고채 3년(%)'}, inplace=True)
            dfs.append(rate_m)
            
        if not ex_rate.empty:
            ex_rate['date'] = pd.to_datetime(ex_rate['date'])
            # 일별 -> 월별 평균
            ex_rate_m = ex_rate.set_index('date').resample('MS')['value'].mean().reset_index()
            ex_rate_m.rename(columns={'value': '원/달러 환율(원)'}, inplace=True)
            dfs.append(ex_rate_m)

        if dfs:
            # Outer Join으로 날짜 병합
            merged = reduce(lambda left, right: pd.merge(left, right, on='date', how='outer'), dfs)
            merged = merged.sort_values('date')
            
            # 이중축 그래프 생성
            fig2 = make_subplots(specs=[[{"secondary_y": True}]])
            
            if 'CPI 상승률(%)' in merged.columns:
                fig2.add_trace(go.Scatter(x=merged['date'], y=merged['CPI 상승률(%)'], name='CPI 상승률(%)'), secondary_y=False)
            if '국고채 3년(%)' in merged.columns:
                fig2.add_trace(go.Scatter(x=merged['date'], y=merged['국고채 3년(%)'], name='국고채 3년(%)'), secondary_y=False)
            if '원/달러 환율(원)' in merged.columns:
                fig2.add_trace(go.Scatter(x=merged['date'], y=merged['원/달러 환율(원)'], name='원/달러 환율', line=dict(dash='dot')), secondary_y=True)

            fig2.update_layout(title="3고 지표 추이 (물가/금리 vs 환율)", hovermode="x unified")
            fig2.update_yaxes(title_text="상승률/금리 (%)", secondary_y=False)
            fig2.update_yaxes(title_text="환율 (원)", secondary_y=True)
            
            st.plotly_chart(fig2, width="stretch")
        else:
            st.info("3고 관련 데이터가 없습니다.")