import streamlit as st
import pandas as pd
import plotly.express as px
import os
import json

from datetime import datetime, timedelta
from WebScrap.DAO import *
from WebScrap.Collector import *
from WebScrap.finance import fetch_latest_data

from views import *


# ==========================================
# 1. 설정 및 상수 정의
# ==========================================
DATA_DIR = "saved_data"
API_KEY_FILE = "apikey.json"  # 상위 폴더에 있다고 가정하거나 경로 수정 필요

st.set_page_config(
    page_title="MoneyView 경제 지표 대시보드",
    page_icon="📊",
    layout="wide"
)

# ==========================================
# 2. 데이터 관리 함수
# ==========================================
def load_data():
    """saved_data 폴더의 모든 CSV 파일을 로드하여 병합합니다."""
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)
        return pd.DataFrame(columns=["category", "name", "code", "value", "unit", "date", "source"])
    
    all_files = [os.path.join(DATA_DIR, f) for f in os.listdir(DATA_DIR) if f.endswith('.csv')]
    df_list = []
    
    for f in all_files:
        try:
            df_list.append(pd.read_csv(f, dtype={'date': str, 'code': str}))
        except Exception as e:
            st.error(f"파일 로드 오류 ({f}): {e}")
            
    if df_list:
        combined_df = pd.concat(df_list, ignore_index=True)
        if 'date' in combined_df.columns:
            combined_df.sort_values(by='date', inplace=True)
        return combined_df
        
    return pd.DataFrame(columns=["category", "name", "code", "value", "unit", "date", "source"])

def save_data(new_data: list[EconomicIndicator]):
    """새로운 데이터를 카테고리별로 나누어 CSV 파일에 저장합니다."""
    if not new_data:
        return

    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)

    # Dataclass List -> DataFrame 변환
    new_df = pd.DataFrame([vars(d) for d in new_data])
    
    # 카테고리별 그룹화 및 저장
    for category, group in new_df.groupby('category'):
        # 파일명 안전하게 변환 (공백 -> 언더바)
        safe_cat = str(category).replace(" ", "_").replace("/", "_")
        file_path = os.path.join(DATA_DIR, f"{safe_cat}.csv")
        
        if os.path.exists(file_path):
            old_df = pd.read_csv(file_path, dtype={'date': str, 'code': str})
            combined_df = pd.concat([old_df, group]).drop_duplicates(subset=['code', 'date'], keep='last')
        else:
            combined_df = group
            
        combined_df['date'] = combined_df['date'].astype(str)
        combined_df.sort_values(by='date', inplace=True)
        combined_df.to_csv(file_path, index=False, encoding='utf-8-sig')
        
    return new_df

def format_ecos_date(dt, cycle):
    """ECOS API 요청용 날짜 포맷 변환"""
    if cycle == 'D': return dt.strftime("%Y%m%d")
    if cycle == 'M': return dt.strftime("%Y%m")
    if cycle == 'Q': return f"{dt.year}Q{(dt.month-1)//3 + 1}"
    if cycle == 'A': return dt.strftime("%Y")
    return dt.strftime("%Y%m")



# ==========================================
# 3. UI 구성 (Streamlit)
# ==========================================

# 사이드바: 설정 및 업데이트
with st.sidebar:
    st.header("⚙️ 설정")
    
    # API 키 로드 시도
    default_ecos_key = ""
    default_fred_key = ""
    if os.path.exists(API_KEY_FILE):
        try:
            with open(API_KEY_FILE, "r") as f:
                keys = json.load(f)
                default_ecos_key = keys.get("ECOS_API_KEY", "")
                default_fred_key = keys.get("FRED", "")
        except:
            pass
            
    ecos_api_key = st.text_input("ECOS API Key", value=default_ecos_key, type="password")
    fred_api_key = st.text_input("FRED API Key", value=default_fred_key, type="password")
    
    st.subheader("📅 데이터 수집 기간 설정")
    # 기본값: 오늘로부터 1년 전 ~ 오늘
    default_end = datetime.now()
    default_start = default_end - timedelta(days=365)
    
    start_dt = st.date_input("시작일", default_start)
    end_dt = st.date_input("종료일", default_end)
    
    if st.button("🔄 데이터 업데이트 (Scraping)"):
        with st.spinner('데이터를 수집하고 있습니다...'):
            new_data = fetch_latest_data(ecos_api_key, fred_api_key, start_dt, end_dt)
            if new_data:
                save_data(new_data)
                st.rerun() # 화면 새로고침

    st.markdown("---")
    st.markdown("**Data Sources:**\n- 한국은행 ECOS\n- Yahoo Finance")
    st.markdown("- FRED (St. Louis Fed)")

# 메인 화면
st.title("📊 MoneyView 경제 지표 대시보드")
st.markdown("통화량, 재정(국채), 물가 데이터를 추적하여 경제 리스크를 모니터링합니다.")

# 데이터 로드
df = load_data()

# 날짜 컬럼 전처리 (그래프 가독성 향상)
def parse_date(date_str):
    s = str(date_str).strip()
    try:
        if "-" in s: # YYYY-MM-DD (Yahoo)
            return datetime.strptime(s, "%Y-%m-%d")
        elif len(s) == 8: # YYYYMMDD (ECOS Daily)
            return datetime.strptime(s, "%Y%m%d")
        elif len(s) == 6: # YYYYMM (ECOS Monthly)
            return datetime.strptime(s, "%Y%m")
        elif len(s) == 4: # YYYY (ECOS Annual)
            return datetime.strptime(s, "%Y")
        elif "Q" in s: # YYYYQn (ECOS Quarterly)
            return datetime.strptime(s[:4] + str(int(s[-1])*3), "%Y%m") # 분기 마지막 월로 근사
    except:
        return None
    return None

if not df.empty:
    df['date'] = df['date'].apply(parse_date)
    df = df.dropna(subset=['date']) # 날짜 변환 실패 데이터 제거

if df.empty:
    st.warning("저장된 데이터가 없습니다. 사이드바에서 '데이터 업데이트'를 눌러주세요.")
else:
    # 탭 구성
    tab1, tab2, tab3, tab4, tab5 = st.tabs(["🔥 인플레이션 본질", "⚖️ 환율/정부실패", "🛡️ 대외 건전성", "💸 자본 유출/전략", "📋 전체 데이터"])

    with tab1:
        inflation.render(df)

    with tab2:
        exchange.render(df)

    with tab3:
        external.render(df)

    with tab4:
        capital.render(df)

    with tab5:
        rawdata.render(df)