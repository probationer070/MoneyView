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
        return pd.DataFrame(columns=["category", "name", "code", "value", "unit", "date", "source", "cycle"])
    
    df_list = []
    # 하위 폴더까지 검색 (os.walk)
    for root, dirs, files in os.walk(DATA_DIR):
        for f in files:
            if f.endswith('.csv'):
                try:
                    df_list.append(pd.read_csv(os.path.join(root, f), dtype={'date': str, 'code': str, 'cycle': str}))
                except UnicodeDecodeError:
                    try:
                        df_list.append(pd.read_csv(os.path.join(root, f), dtype={'date': str, 'code': str, 'cycle': str}, encoding='cp949'))
                    except Exception as e:
                        st.error(f"파일 로드 오류 ({f}) - 인코딩 실패: {e}")
                except Exception as e:
                    st.error(f"파일 로드 오류 ({f}): {e}")
            
    if df_list:
        combined_df = pd.concat(df_list, ignore_index=True)
        if 'date' in combined_df.columns:
            combined_df.sort_values(by='date', inplace=True)
        return combined_df
        
    return pd.DataFrame(columns=["category", "name", "code", "value", "unit", "date", "source", "cycle"])

def save_data(new_data: list[EconomicIndicator]):
    """새로운 데이터를 카테고리별 폴더에 개별 CSV 파일로 저장합니다."""
    if not new_data:
        return

    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)

    # Dataclass List -> DataFrame 변환
    new_df = pd.DataFrame([vars(d) for d in new_data])
    
    # 카테고리별 그룹화
    for category, cat_group in new_df.groupby('category'):
        # 카테고리 폴더 생성
        safe_cat = str(category).replace(" ", "_").replace("/", "_")
        cat_dir = os.path.join(DATA_DIR, safe_cat)
        if not os.path.exists(cat_dir):
            os.makedirs(cat_dir)
        
        # 지표별(name) 개별 저장
        for name, item_group in cat_group.groupby('name'):
            safe_name = str(name).replace("/", "_").replace(" ", "_").replace("(", "").replace(")", "")
            file_path = os.path.join(cat_dir, f"{safe_name}.csv")
            
            if os.path.exists(file_path):
                old_df = pd.read_csv(file_path, dtype={'date': str, 'code': str, 'cycle': str})
                combined_df = pd.concat([old_df, item_group]).drop_duplicates(subset=['code', 'date'], keep='last')
            else:
                combined_df = item_group
                
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
    
    st.subheader("📅 데이터 수집 설정")
    
    # 수집 대상 선택 (Selective Crawling)
    available_sources = ["ECOS (한국은행)", "FRED (미 연준)", "Yahoo Finance (글로벌)"]
    selected_labels = st.multiselect("수집 대상 선택", available_sources, default=available_sources)
    
    source_map = {
        "ECOS (한국은행)": "ECOS",
        "FRED (미 연준)": "FRED",
        "Yahoo Finance (글로벌)": "Yahoo"
    }
    selected_keys = [source_map[label] for label in selected_labels]
    
    # 기본값: 오늘로부터 2000년 ~ 오늘
    default_end = datetime.now()
    default_start = datetime(2000, 1, 1)
    
    # 날짜 선택 범위 확장 (기본값은 value 기준 +/- 10년으로 제한됨)
    min_date = datetime(2000, 1, 1)
    max_date = datetime.now() + timedelta(days=365)

    start_dt = st.date_input("시작일", default_start, min_value=min_date, max_value=max_date)
    end_dt = st.date_input("종료일", default_end, min_value=min_date, max_value=max_date)
    
    if st.button("🔄 데이터 업데이트 (Scraping)"):
        with st.spinner('데이터를 수집하고 있습니다...'):
            new_data = fetch_latest_data(ecos_api_key, fred_api_key, start_dt, end_dt, sources=selected_keys)
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

if not df.empty:
    df['date'] = df['date'].apply(parse_date)
    df = df.dropna(subset=['date']) # 날짜 변환 실패 데이터 제거

if df.empty:
    st.warning("저장된 데이터가 없습니다. 사이드바에서 '데이터 업데이트'를 눌러주세요.")
else:
    # 탭 구조 정의 (카테고리 -> {세부항목: 렌더링함수})
    tabs_structure = {
        "📈 물가/인플레이션": {
            "🔥 인플레이션 본질": inflation,
            "🏭 비용/인플레": cost_inflation,
            "💸 통화 살포/부메랑": currency_boomerang,
            "🛑 공급측/규제 인플레": supply_regulation,
            "📉 스태그플레이션": stagflation
        },
        "🌍 환율/대외건전성": {
            "⚖️ 환율/정부실패": exchange,
            "🛡️ 대외 건전성": external,
            "🌊 자금 이동/환율": capital_flow,
            "🚫 금융 억압/자본 통제": financial_repression
        },
        "💰 자본/부채/금리": {
            "💸 자본 유출/전략": capital,
            "💣 부채/금리": debt_crisis,
            "🏛️ 공공 개입/부채": public_intervention,
            "🏦 은행/배드뱅크": bank_risk,
            "📈 국채 폭등/구축 효과": bond_spike
        },
        "👥 사회/구조": {
            "🏚️ 세대/세금": generation_wealth,
            "🏗️ 주택 공급/붕괴": supply_collapse,
            "💼 고용/유동성 구축": employment_crisis
        },
        "📋 전체 데이터": {
            "📋 전체 데이터": rawdata
        }
    }

    # 상위 탭 생성
    main_tab_names = list(tabs_structure.keys())
    main_tabs = st.tabs(main_tab_names)

    # 각 탭 내부 구성
    for tab, category in zip(main_tabs, main_tab_names):
        with tab:
            sub_views = tabs_structure[category]
            sub_view_names = list(sub_views.keys())
            
            # 하위 탭이 여러 개일 경우 드롭다운 제공
            if len(sub_view_names) > 1:
                col_sel, _ = st.columns([1, 3])
                with col_sel:
                    selected_sub = st.selectbox(
                        "세부 주제 선택", 
                        sub_view_names, 
                        key=f"sel_{category}", 
                        label_visibility="collapsed"
                    )
            else:
                selected_sub = sub_view_names[0]
            
            # 선택된 뷰 렌더링
            sub_views[selected_sub].render(df)