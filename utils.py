import pandas as pd
import plotly.express as px
import streamlit as st

def calculate_yoy(df, target_name):
    """전년 동기 대비 증가율(YoY) 계산"""
    sub_df = df[df['name'] == target_name].copy()
    if sub_df.empty:
        return pd.DataFrame()
    sub_df = sub_df.sort_values('date')
    # 월별 데이터 가정 (12개월 전 대비 변동률)
    sub_df['value'] = sub_df['value'].pct_change(periods=12) * 100
    sub_df['name'] = f"{target_name} (YoY %)"
    sub_df = sub_df.dropna(subset=['value'])
    return sub_df

def plot_metric(df, category_filter, title):
    # 카테고리나 이름으로 필터링
    filtered_df = df[df['name'].str.contains(category_filter) | df['category'].str.contains(category_filter)]
    if not filtered_df.empty:
        fig = px.line(filtered_df, x='date', y='value', color='name', markers=True,
                      title=title, labels={'value': '값', 'date': '날짜'})
        st.plotly_chart(fig, use_container_width=True)
    else:
        st.info(f"{title} 관련 데이터가 아직 없습니다.")