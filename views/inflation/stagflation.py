import streamlit as st
import plotly.express as px
import pandas as pd
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
            st.plotly_chart(fig1, use_container_width=True)
        else:
            st.info("무역수지 데이터가 없습니다. (수집 필요)")

    with col2:
        # 3고 현상 (물가, 금리, 환율 정규화 비교)
        st.markdown("##### 2. 3고 현상 (물가·금리·환율)")
        cpi = df[df['name'].str.contains("CPI(총지수)")].copy()
        rate = df[df['name'].str.contains("국고채") & df['name'].str.contains("3년")].copy()
        ex_rate = df[df['name'].str.contains("원/미국달러")].copy()
        
        if not cpi.empty and not rate.empty and not ex_rate.empty:
            # 정규화 (최초값 = 100)
            cpi = cpi.sort_values('date')
            rate = rate.sort_values('date')
            ex_rate = ex_rate.sort_values('date')
            
            # 날짜 교집합
            common_dates = set(cpi['date']).intersection(set(rate['date'])).intersection(set(ex_rate['date']))
            
            if common_dates:
                cpi = cpi[cpi['date'].isin(common_dates)]
                rate = rate[rate['date'].isin(common_dates)]
                ex_rate = ex_rate[ex_rate['date'].isin(common_dates)]
                
                cpi['idx'] = (cpi['value'] / cpi['value'].iloc[0]) * 100
                rate['idx'] = (rate['value'] / rate['value'].iloc[0]) * 100
                ex_rate['idx'] = (ex_rate['value'] / ex_rate['value'].iloc[0]) * 100
                
                merged = pd.DataFrame({
                    'date': cpi['date'],
                    '물가(CPI)': cpi['idx'],
                    '금리(국고3년)': rate['idx'],
                    '환율(원/달러)': ex_rate['idx']
                })
                
                fig2 = px.line(merged, x='date', y=['물가(CPI)', '금리(국고3년)', '환율(원/달러)'], title="3고 지표 추이 (Start=100)", labels={'value': '지수'})
                st.plotly_chart(fig2, use_container_width=True)
            else:
                st.info("날짜 교집합이 부족합니다.")
        else:
            st.info("3고 관련 데이터 중 일부가 누락되었습니다.")

    # 실질 착취율 (인플레이션 + 세금/비용)
    st.markdown("##### 3. 실질 착취율 (인플레이션 + 비용)")
    cpi_yoy = calculate_yoy(df, "CPI(총지수)")
    if not cpi_yoy.empty:
        fig3 = px.area(cpi_yoy, x='date', y='value', title="인플레이션(CPI YoY) - 기본 착취율", labels={'value': '%'})
        st.plotly_chart(fig3, use_container_width=True)