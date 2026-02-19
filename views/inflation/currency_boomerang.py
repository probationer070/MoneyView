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
            st.plotly_chart(fig1, width="stretch")
        else:
            st.info("CPI 데이터가 없습니다.")

    with col2:
        # 기준금리 vs 시장금리 괴리
        st.markdown("##### 2. 기준금리 vs 시장금리(국채) 추이")
        base_rate = df[df['name'].str.contains("기준금리") & df['name'].str.contains("한국은행")].copy()
        market_rate = df[df['name'].str.contains("국고채") & df['name'].str.contains("3년")].copy()
        # 1. 날짜 형식을 '년월'로 인식하도록 변환
        base_rate['date'] = pd.to_datetime(base_rate['date'])
        market_rate['date'] = pd.to_datetime(market_rate['date'])
        
        if not market_rate.empty:
            if not base_rate.empty:
                # 병합 (날짜 불일치 해결을 위해 outer join 후 ffill)
                merged = pd.merge(base_rate[['date', 'value']], market_rate[['date', 'value']], on='date', how='outer', suffixes=('_base', '_market'))
                merged = merged.sort_values('date').reset_index(drop=True)
                merged['value_base'] = merged['value_base'].ffill()  # 기준금리 유지
                merged = merged.dropna(subset=['value_market'])      # 시장금리가 있는 날짜 기준
                merged = merged.dropna(subset=['value_base'])        # ffill 후 남은 결측치(초기값) 제거
                merged.rename(columns={'value_base': '기준금리', 'value_market': '국고채 3년'}, inplace=True)
                
                fig2 = px.line(merged, x='date', y=['기준금리', '국고채 3년'], 
                               title="기준금리 및 시장금리 추이", 
                               labels={'value': '금리(%)', 'variable': '구분', 'date': '날짜'},
                               color_discrete_map={'기준금리': 'skyblue', '국고채 3년': 'red'})
                st.plotly_chart(fig2, width="stretch")
                st.caption("💡 기준금리(검정)와 시장금리(빨강)의 흐름을 비교하여 괴리를 확인하십시오.")
            else:
                # 기준금리 없으면 국채만 표시
                fig2 = px.line(market_rate, x='date', y='value', title="시장 금리 (국고채 3년)", labels={'value': '금리(%)'})
                st.plotly_chart(fig2, width="stretch")
                st.caption("💡 기준금리 데이터가 없어 시장 금리만 표시합니다.")
        else:
            st.info("금리 데이터가 없습니다.")

    # 환율 변동성 (Debasement)
    st.markdown("##### 3. 원/달러 환율 변동성 (화폐 탈출)")
    ex_rate = df[df['name'] == "원/미국달러"].copy()
    if not ex_rate.empty:
        fig3 = px.line(ex_rate, x='date', y='value', title="원/미국달러 환율 추이", labels={'value': '환율(원)'})
        st.plotly_chart(fig3, width="stretch")
    else:
        st.info("환율 데이터가 없습니다.")
