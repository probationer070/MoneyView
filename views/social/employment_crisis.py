import streamlit as st
import plotly.express as px
import pandas as pd
from utils import calculate_yoy
import plotly.graph_objects as go
from plotly.subplots import make_subplots

def render(df):
    st.subheader("고용 시장 동력 상실 및 유동성 구축 효과")
    st.markdown("**플랫폼 규제와 스타트업 투자 위축이 가져올 '신입 채용 지옥'**")

    col1, col2 = st.columns(2)
    
    with col1:
        # 해외 VC 투자 규모 (데이터 부재 시 안내) TODO: No Data
        st.markdown("##### 1. 벤처투자(VC) 및 스타트업 자금")
        vc_data = df[df['name'].str.contains("벤처") | df['name'].str.contains("VC")].copy()
        
        if not vc_data.empty:
            fig1 = px.bar(vc_data, x='date', y='value', title="벤처투자 규모 추이", labels={'value': '금액'})
            st.plotly_chart(fig1, width="stretch")
        else:
            st.info("VC 투자 규모 데이터가 없습니다. (별도 수집 필요)")

    with col2:
        # 채용 공고 수 (데이터 부재 시 안내) TODO: No Data
        st.markdown("##### 2. 주요 기업 채용 공고 추이")
        hiring_data = df[df['name'].str.contains("채용") | df['name'].str.contains("구인")].copy()
        
        if not hiring_data.empty:
            fig2 = px.line(hiring_data, x='date', y='value', title="채용 공고 수 추이", labels={'value': '건수'})
            st.plotly_chart(fig2, width="stretch")
        else:
            st.info("채용 공고 데이터가 없습니다.")

    # M2 vs 중소기업 대출 금리 (구축 효과)
    st.markdown("##### 3. M2 통화량 vs 중소기업 대출 금리 (구축 효과)")
    m2 = df[df['name'].str.contains("M2") & df['name'].str.contains("평잔")].copy()
    sme_rate = df[df['name'].str.contains("중소기업대출금리")].copy()
    
    if not m2.empty and not sme_rate.empty:
        # 날짜 포맷 통일
        m2['date'] = pd.to_datetime(m2['date'])
        sme_rate['date'] = pd.to_datetime(sme_rate['date'])
        
        # 데이터 병합
        merged = pd.merge(m2[['date', 'value']], sme_rate[['date', 'value']], on='date', suffixes=('_m2', '_rate'))
        
        fig3 = make_subplots(specs=[[{"secondary_y": True}]])
        fig3.add_trace(go.Scatter(x=merged['date'], y=merged['value_m2'], name="M2(평잔)"), secondary_y=False)
        fig3.add_trace(go.Scatter(x=merged['date'], y=merged['value_rate'], name="중소기업 대출금리", line=dict(color='red')), secondary_y=True)
        
        fig3.update_layout(title_text="재정 지출(M2)과 시장 금리의 상관관계")
        st.plotly_chart(fig3, width="stretch")
    else:
        st.info("M2 또는 중소기업 대출 금리 데이터가 부족합니다.")