import streamlit as st
import plotly.express as px
import pandas as pd

def render(df):
    st.subheader("사회적 비용 지수")
    st.markdown("""
    **최저임금과 사회보험료(건강보험, 국민연금) 인상률을 종합하여 '실질 사회적 비용'의 증가 추세를 시각화합니다.**
    
    이는 기업의 고정 비용 부담과 개인의 준조세 부담이 얼마나 가중되는지를 보여주는 지표입니다.
    """)

    min_wage = df[df['name'].str.contains("최저임금")].copy()
    social_insurance = df[df['name'].str.contains("보험료율")].copy()

    if min_wage.empty or social_insurance.empty:
        st.info("사회적 비용을 계산하기 위한 최저임금 또는 사회보험료 데이터가 부족합니다.\n\n"
                "데이터 전처리 스크립트(`data_preprocessor.py`)를 실행했는지, "
                "`사회보험료.csv` 파일을 생성했는지 확인해주세요.")
        return

    # --- 데이터 전처리 ---
    # 연도별로 데이터를 집계하기 위해 'date'를 연도로 통일
    min_wage['year'] = pd.to_datetime(min_wage['date']).dt.year
    social_insurance['year'] = pd.to_datetime(social_insurance['date']).dt.year

    # 연도별 최저임금 인상률(YoY) 계산
    min_wage = min_wage.sort_values('year').drop_duplicates('year', keep='last')
    min_wage['yoy_increase'] = min_wage['value'].pct_change() * 100
    
    # 연도별 사회보험료율 합산
    insurance_pivot = social_insurance.pivot_table(index='year', columns='name', values='value')
    insurance_pivot['total_rate'] = insurance_pivot.sum(axis=1)
    insurance_pivot = insurance_pivot.reset_index()

    # --- 지수 계산 ---
    # 데이터 병합
    merged_df = pd.merge(min_wage[['year', 'yoy_increase']], insurance_pivot[['year', 'total_rate']], on='year', how='inner')
    merged_df.rename(columns={'yoy_increase': '최저임금 인상률(%)', 'total_rate': '주요 사회보험료율(%)'}, inplace=True)
    
    # 정규화 (2015년=100)
    start_year = 2015
    merged_df = merged_df[merged_df['year'] >= start_year].copy()
    
    if not merged_df.empty:
        merged_df['최저임금 지수'] = (1 + merged_df['최저임금 인상률(%)'] / 100).cumprod() * 100
        merged_df['사회보험료 지수'] = (merged_df['주요 사회보험료율(%)'] / merged_df['주요 사회보험료율(%)'].iloc[0]) * 100
        
        # 사회적 비용 종합 지수 (가중치 50:50)
        merged_df['사회적 비용 종합지수'] = (merged_df['최저임금 지수'] * 0.5) + (merged_df['사회보험료 지수'] * 0.5)

        # --- 시각화 ---
        st.markdown(f"#### 사회적 비용 지수 추이 ({start_year}년=100)")
        
        plot_df = merged_df.melt(id_vars=['year'], value_vars=['최저임금 지수', '사회보험료 지수', '사회적 비용 종합지수'],
                                 var_name='지표', value_name='지수 값')
        
        fig = px.line(plot_df, x='year', y='지수 값', color='지표',
                      title=f"사회적 비용 관련 지수 변화 ({start_year}년=100)",
                      labels={'year': '연도', '지수 값': '지수 (기준=100)'})
        fig.update_layout(legend_title_text='지표 구분')
        st.plotly_chart(fig, use_container_width=True)
        
        with st.expander("데이터 테이블 보기"):
            st.dataframe(merged_df.set_index('year'))
    else:
        st.warning(f"{start_year}년 이후의 데이터가 부족하여 지수를 계산할 수 없습니다.")