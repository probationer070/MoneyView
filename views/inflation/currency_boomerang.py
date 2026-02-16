import streamlit as st
import plotly.express as px
import pandas as pd
from utils import calculate_yoy

def render(df):
    st.subheader("통화 살포와 물가의 부메랑")
    st.markdown("**'소비쿠폰' 등 현금 살포가 금리 인하를 막고 인플레이션을 유발하는 과정**")

    col1, col2 = st.columns(2)

    with col1:
        # CPI 및 근원물가
        st.markdown("##### 1. 소비자물가(CPI) 추이")
        cpi = df[df['name'].str.contains("CPI")].copy()
        if not cpi.empty:
            fig1 = px.line(cpi, x='date', y='value', color='name', title="소비자물가지수 추이", labels={'value': '지수'})
            st.plotly_chart(fig1, use_container_width=True)
        else:
            st.info("CPI 데이터가 없습니다.")

    with col2:
        # 기준금리 vs 시장금리 괴리
        st.markdown("##### 2. 기준금리 vs 시장금리(국채) 괴리")
        base_rate = df[df['name'].str.contains("기준금리")].copy()
        market_rate = df[df['name'].str.contains("국고채") & df['name'].str.contains("3년")].copy()
        
        if not market_rate.empty:
            if not base_rate.empty:
                # 병합 및 괴리 계산
                merged = pd.merge(base_rate[['date', 'value']], market_rate[['date', 'value']], on='date', suffixes=('_base', '_market'))
                merged['spread'] = merged['value_market'] - merged['value_base']
                fig2 = px.line(merged, x='date', y='spread', title="시장금리 - 기준금리 스프레드", labels={'spread': '차이(%p)'})
                fig2.add_hline(y=0, line_dash="dash", line_color="gray")
                st.plotly_chart(fig2, use_container_width=True)
                st.caption("💡 스프레드가 확대되면 중앙은행의 통제력이 약화되고 있다는 신호입니다.")
            else:
                # 기준금리 없으면 국채만 표시
                fig2 = px.line(market_rate, x='date', y='value', title="시장 금리 (국고채 3년)", labels={'value': '금리(%)'})
                st.plotly_chart(fig2, use_container_width=True)
                st.caption("💡 기준금리 데이터가 없어 시장 금리만 표시합니다.")
        else:
            st.info("금리 데이터가 없습니다.")

    # 환율 변동성 (Debasement)
    st.markdown("##### 3. 원/달러 환율 변동성 (화폐 탈출)")
    ex_rate = df[df['name'] == "원/미국달러"].copy()
    if not ex_rate.empty:
        fig3 = px.line(ex_rate, x='date', y='value', title="원/미국달러 환율 추이", labels={'value': '환율(원)'})
        st.plotly_chart(fig3, use_container_width=True)
    else:
        st.info("환율 데이터가 없습니다.")
