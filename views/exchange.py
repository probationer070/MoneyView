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
            st.plotly_chart(fig_fail, use_container_width=True)
            st.caption("💡 Gap이 커질수록 외부 요인(달러 강세)보다 내부 요인(원화 가치 훼손)이 크다는 뜻입니다.")

    with col2:
        plot_metric(df, "실질실효환율", "실질실효환율 (REER)")
        st.caption("💡 100 아래라면 한국의 구매력이 과거 평균보다 낮아졌음을 의미합니다.")