import pandas as pd
import plotly.express as px
import streamlit as st

def calculate_yoy(df, target_name):
    """전년 동기 대비 증가율(YoY) 계산"""
    sub_df = df[df['name'] == target_name].copy()
    if sub_df.empty:
        return pd.DataFrame()
    sub_df = sub_df.sort_values('date')

    # 데이터 주기에 따라 YoY 계산 기간(periods) 동적 결정
    periods = 12 # 기본값 월별
    if 'cycle' in sub_df.columns and not sub_df['cycle'].empty:
        # 데이터프레임에 'cycle' 정보가 있으면 사용
        cycle_val = sub_df['cycle'].iloc[0]
        if isinstance(cycle_val, str):
            cycle = cycle_val.upper()
            if cycle == 'Q':
                periods = 4
            elif cycle == 'A':
                periods = 1

    sub_df['value'] = sub_df['value'].pct_change(periods=periods) * 100
    sub_df['name'] = f"{target_name} (YoY %)"
    sub_df = sub_df.dropna(subset=['value'])
    return sub_df

def plot_metric(df, category_filter, title):
    # 카테고리나 이름으로 필터링
    filtered_df = df[df['name'].str.contains(category_filter) | df['category'].str.contains(category_filter)]
    if not filtered_df.empty:
        fig = px.line(filtered_df, x='date', y='value', color='name', markers=True,
                      title=title, labels={'value': '값', 'date': '날짜'})
        st.plotly_chart(fig, width="stretch")
    else:
        st.info(f"{title} 관련 데이터가 아직 없습니다.")

def parse_quarterly_date(date_str):
    """
    '2020Q4' 또는 '2020.Q4' 형식의 문자열을 해당 분기의 마지막 날짜로 변환합니다.
    """
    if not isinstance(date_str, str):
        return pd.to_datetime(date_str)
    
    try:
        # 'Q'를 기준으로 연도와 분기 분리
        year, quarter = date_str.replace('.', '').split('Q')
        # Pandas의 Period를 사용하여 분기 마지막 날로 변환
        return pd.Period(year=int(year), quarter=int(quarter), freq='Q').to_timestamp(how='end').normalize()
    except Exception:
        # 파싱 실패 시 기본 pd.to_datetime 시도
        return pd.to_datetime(date_str, errors='coerce')