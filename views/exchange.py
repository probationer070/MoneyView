import streamlit as st
import plotly.express as px
import pandas as pd
from utils import plot_metric

def render(df):
    st.subheader("환율과 화폐 가치의 독립성")
    st.markdown("> **\"환율은 상대적이지만, 화폐 가치 하락은 정부의 실패다.\"**")
    
    col1, col2 = st.columns(2)
    with col1:
        # 정부 실패 지수 (Gov Failure Index)
        # 로직: (USD/KRW 변동률) - (DXY 변동률)
        dxy = df[df['code'] == "DX-Y.NYB"].sort_values('date')
        krw = df[df['name'] == "원/미국달러"].sort_values('date')
        
        if not dxy.empty and not krw.empty:
            # 기준일 설정 (데이터의 시작점)
            start_date_common = max(dxy['date'].min(), krw['date'].min())
            dxy = dxy[dxy['date'] >= start_date_common].set_index('date')['value']
            krw = krw[krw['date'] >= start_date_common].set_index('date')['value']
            
            # 지수화 (시작일 = 100)
            dxy_idx = (dxy / dxy.iloc[0]) * 100
            krw_idx = (krw / krw.iloc[0]) * 100
            
            # 데이터 프레임 병합
            failure_df = pd.DataFrame({'DXY(달러강세)': dxy_idx, 'KRW(환율)': krw_idx}).dropna()
            failure_df['정부실패분(Gap)'] = failure_df['KRW(환율)'] - failure_df['DXY(달러강세)']
            
            fig_fail = px.line(failure_df, title="정부 실패 지수 (달러 강세 vs 원화 약세 괴리)",
                               labels={'value': '지수 (Start=100)', 'date': '날짜'})
            st.plotly_chart(fig_fail, width="stretch")
            st.caption("💡 Gap이 커질수록 외부 요인(달러 강세)보다 내부 요인(원화 가치 훼손)이 크다는 뜻입니다.")

    with col2:
        # 실질실효환율 (REER) Proxy 계산
        # REER Proxy = (한국CPI / (미국CPI * 환율)) * 100
        krw_usd = df[df['name'] == "원/미국달러"].copy()
        kr_cpi = df[df['name'] == "CPI(총지수)"].copy()
        us_cpi = df[df['name'] == "미국 CPI"].copy()

        if not krw_usd.empty and not kr_cpi.empty and not us_cpi.empty:
            krw_usd['date'] = pd.to_datetime(krw_usd['date'])
            kr_cpi['date'] = pd.to_datetime(kr_cpi['date'])
            us_cpi['date'] = pd.to_datetime(us_cpi['date'])

            # 환율 월평균 (일별 -> 월별)
            krw_usd = krw_usd.set_index('date').resample('MS')['value'].mean().reset_index()

            # 데이터 병합
            merged = pd.merge(krw_usd, kr_cpi[['date', 'value']], on='date', suffixes=('_rate', '_kr'))
            merged = pd.merge(merged, us_cpi[['date', 'value']], on='date') # value는 us_cpi
            
            if not merged.empty:
                # 2000년=100 기준 지수화: (한국CPI / (미국CPI * 환율))
                merged['raw_reer'] = merged['value_kr'] / (merged['value'] * merged['value_rate'])
                base_val = merged[merged['date'].dt.year == 2000]['raw_reer'].mean()
                if pd.isna(base_val): base_val = merged['raw_reer'].iloc[0]
                
                merged['REER'] = (merged['raw_reer'] / base_val) * 100
                
                fig_reer = px.line(merged, x='date', y='REER', title="실질실효환율 (REER) Proxy (2000=100)",
                                   labels={'REER': '지수', 'date': '날짜'})
                fig_reer.add_hline(y=100, line_dash="dash", line_color="gray")
                st.plotly_chart(fig_reer, width="stretch")
                st.caption("💡 (한국CPI / (미국CPI × 환율))로 추산한 구매력 지수입니다. 100 이하는 2000년 대비 대외 구매력 약화를 의미합니다.")
            else:
                st.info("실질실효환율 계산을 위한 데이터(날짜 교집합)가 부족합니다.")
        else:
            st.info("실질실효환율 계산을 위한 데이터(환율, 한국CPI, 미국CPI)가 부족합니다.")