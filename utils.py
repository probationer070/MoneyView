import pandas as pd
import plotly.express as px
import streamlit as st
import hashlib
import json
import csv
import os

from datetime import datetime

HIGH_PRIORITY_KEYWORDS = ["President", "White House", "Fed", "FOMC", "Interest Rate", "BOK", "한국은행", "대통령", "연준", "금리"]

def get_hash(text):
    return hashlib.md5(text.encode('utf-8')).hexdigest()

def get_importance(text):
    text_lower = text.lower()
    for kw in HIGH_PRIORITY_KEYWORDS:
        if kw.lower() in text_lower:
            return 5
    return 1

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

def calculate_mom(df, target_name):
        """월별 증감률(MoM) 계산"""
        sub_df = df[df['name'] == target_name].copy()
        if sub_df.empty:
            return pd.DataFrame()
        sub_df = sub_df.sort_values('date')
        sub_df['value'] = sub_df['value'].pct_change(periods=1) * 100
        sub_df = sub_df.dropna(subset=['value'])
        return sub_df

def plot_metric(df, category_filter, title):
    """카테고리나 이름으로 필터링"""
    filtered_df = df[df['name'].str.contains(category_filter) | df['category'].str.contains(category_filter)]
    if not filtered_df.empty:
        fig = px.line(filtered_df, x='date', y='value', color='name', markers=True,
                      title=title, labels={'value': '값', 'date': '날짜'},
                      hover_data={'date': '|%Y-%m-%d', 'value': ':.2f', 'name': True})
        # Add basic tooltips for any source or description if available
        if 'source' in filtered_df.columns:
            fig.update_traces(hovertemplate='<b>%{hovertext}</b><br>날짜: %{x|%Y-%m-%d}<br>값: %{y:.2f}<br>출처: %{customdata[0]}<extra></extra>',
                              customdata=filtered_df[['source']])
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
    
# 날짜 컬럼 전처리 (그래프 가독성 향상)
def parse_date(date_str):
    s = str(date_str).strip()
    try:
        if "Q" in s: # YYYYQn (ECOS Quarterly) - 가장 먼저 체크
            year = s[:4]
            quarter = int(s.split('Q')[1])
            month = quarter * 3
            return datetime.strptime(f"{year}{month:02d}", "%Y%m")
        elif "-" in s: # YYYY-MM-DD (Yahoo)
            return datetime.strptime(s, "%Y-%m-%d")
        elif len(s) == 8: # YYYYMMDD (ECOS Daily)
            return datetime.strptime(s, "%Y%m%d")
        elif len(s) == 6: # YYYYMM (ECOS Monthly)
            return datetime.strptime(s, "%Y%m")
        elif len(s) == 4: # YYYY (ECOS Annual)
            return datetime.strptime(s, "%Y")
    except:
        return None
    return None

    
def load_json(filepath):
    if os.path.exists(filepath):
        with open(filepath, 'r', encoding='utf-8') as f:
            try:
                return json.load(f)
            except:
                return []
    return []

def save_json(filepath, data):
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

def load_articles_from_csv(filepath):
    if not os.path.exists(filepath):
        return []
    articles = []
    try:
        with open(filepath, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                articles.append(row)
    except Exception:
        return []
    return articles