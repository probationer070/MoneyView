import streamlit as st
import plotly.express as px
import pandas as pd
from utils import plot_metric

def render(df):
    st.subheader("자본 유출과 멀티커런시 전략")
    st.markdown("**'아시아 자본의 이동'과 개인의 탈출 속도**")
    
    col1, col2 = st.columns(2)
    with col1:
        # 3국 금리 비교
        yields = df[df['name'].str.contains("국고채\(10년\)|미국 10년물|일본 국채 10년물")]
        if not yields.empty:
            fig_yields = px.line(yields, x='date', y='value', color='name',
                                 title="한·미·일 국채 10년물 금리 비교", labels={'value': '금리(%)'})
            st.plotly_chart(fig_yields, width="stretch")
            
    with col2:
        # 거주자 외화예금 계산 (전체 외화예금 - 비거주자 외화예금)
        total_forex = df[df['name'] == "외화예금"].copy()
        non_resident = df[df['name'] == "비거주자 외화예금"].copy()

        if not total_forex.empty or not non_resident.empty:
            total_forex['date'] = pd.to_datetime(total_forex['date'])
            non_resident['date'] = pd.to_datetime(non_resident['date'])

            merged = pd.merge(total_forex[['date', 'value']], non_resident[['date', 'value']], on='date', suffixes=('_total', '_non'))
            merged['resident_value'] = merged['value_total'] - merged['value_non']

            fig_forex = px.line(merged, x='date', y='resident_value', markers=True,
                                title="거주자 외화예금 추이 (계산됨)",
                                labels={'resident_value': '잔액 (십억원)', 'date': '날짜'})
            st.plotly_chart(fig_forex, width="stretch")
            st.caption("💡 전체 외화예금에서 비거주자분을 제외한 수치입니다. 급증 시 내부 자본의 달러 이동을 의미합니다.")
        else:
            plot_metric(df, "거주자외화예금", "거주자 외화예금 잔액 (달러 선호도)")
            st.caption("💡 이 수치가 급증한다면 스마트 머니가 원화를 버리고 달러로 이동 중이라는 신호입니다.")