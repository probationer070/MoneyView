import streamlit as st
import plotly.express as px
import pandas as pd
from utils import plot_metric

def render(df):
    st.subheader("노동 가치의 하락 (Labor Value)")
    st.markdown("> **\"임금 상승 속도보다 빠른 자산과 체감 물가 상승\"**")
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.markdown("##### 1. 명목 임금 vs 주택 매매가격")
        wage = df[df['name'].str.contains("임금|가구소득")].copy()
        house_price = df[df['name'].str.contains("주택매매가격지수")].copy()
        
        if not house_price.empty:
            if wage.empty:
                # 임금 데이터가 없으면 주택 가격 단독 표시
                fig1 = px.line(house_price, x='date', y='value', color='name',
                               title="부동산(주택) 가격 지수 추이", labels={'value': '지수', 'date': '날짜'})
                st.plotly_chart(fig1, width="stretch")
                st.caption("💡 임금 데이터가 부재하여 주택 가격 추이만 표시합니다.")
            else:
                merged = pd.merge(wage[['date', 'value']], house_price[['date', 'value']], on='date', how='outer', suffixes=('_wage', '_house'))
                merged = merged.sort_values('date').ffill().dropna()
                # 2017년 등 특정 시점을 100으로 지수화 필요 (예시로 단순 비교)
                fig1 = px.line(merged, x='date', y=['value_wage', 'value_house'], 
                               title="명목 임금 vs 주택 가격 지수", labels={'value': '지표값', 'variable': '구분'})
                st.plotly_chart(fig1, width="stretch")
        else:
            st.info("명목 임금 및 주택 가격 데이터가 부족합니다.")

    with col2:
        
        st.markdown("##### 3. 지역별 아파트 매매 실거래가 지수")

        # 서울과 수도권 아파트 지수 필터링 및 통합
        seoul_mask = df['name'].str.contains("아파트 매매 실거래가격지수", na=False) & df['name'].str.contains("서울", na=False)
        capital_mask = df['name'].str.contains("아파트 매매 실거래가격지수", na=False) & df['name'].str.contains("수도권", na=False)
        
        regional_housing = df[seoul_mask | capital_mask].copy()

        if not regional_housing.empty:
            regional_housing = regional_housing.sort_values('date')
            fig3 = px.line(regional_housing, x='date', y='value', color='name',
                           title="지역별 아파트 가격 지수 비교", labels={'value': '지수', 'date': '날짜'})
            st.plotly_chart(fig3, width="stretch")
        else:
            st.info("지역별 아파트 가격 데이터가 없습니다.")

    st.markdown("---")
    st.markdown("💡 **인사이트**: 평범한 노동 소득만으로는 자산(집)을 구매하거나 높은 체감 물가를 방어하기 힘든 '노동 가치 박탈' 현상을 확인합니다.")
