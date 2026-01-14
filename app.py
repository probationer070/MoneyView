import streamlit as st
import pandas as pd
import plotly.express as px
import os
import json
from datetime import datetime
from webscrap.finance import ECOSCollector, GlobalMacroCollector, EconomicIndicator

# ==========================================
# 1. 설정 및 상수 정의
# ==========================================
DATA_FILE = "economic_data.csv"
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
    """로컬 CSV 파일에서 데이터를 로드합니다."""
    if os.path.exists(DATA_FILE):
        df = pd.read_csv(DATA_FILE)
        return df
    return pd.DataFrame(columns=["category", "name", "code", "value", "unit", "date", "source"])

def save_data(new_data: list[EconomicIndicator]):
    """새로운 데이터를 기존 데이터에 병합하여 저장합니다."""
    if not new_data:
        return

    # Dataclass List -> DataFrame 변환
    new_df = pd.DataFrame([vars(d) for d in new_data])
    
    if os.path.exists(DATA_FILE):
        old_df = pd.read_csv(DATA_FILE)
        # 날짜와 코드가 같은 중복 데이터 제거 후 병합 (최신 데이터 우선)
        combined_df = pd.concat([old_df, new_df]).drop_duplicates(subset=['code', 'date'], keep='last')
    else:
        combined_df = new_df

    # 날짜 기준 정렬
    combined_df.sort_values(by='date', inplace=True)
    combined_df.to_csv(DATA_FILE, index=False, encoding='utf-8-sig')
    return combined_df

def fetch_latest_data(api_key):
    """ECOS 및 Yahoo Finance에서 최신 데이터를 수집합니다."""
    indicators = []
    status_text = st.empty()
    
    # 1. ECOS 수집기 초기화
    if not api_key:
        st.error("ECOS API 키가 필요합니다.")
        return []
        
    ecos = ECOSCollector(api_key)
    
    # 수집 대상 정의 (원시데이터.md 기반 통화, 재정, 물가 핵심 지표)
    # (통계표코드, 항목코드, 이름, 단위, 주기)
    targets = [
        # [통화] M2 통화량
        ("102Y004", "BBHA00", "M2(평잔)", "십억원", "M"), 
        
        # [물가] 소비자물가지수, 생산자물가지수(대체 가능 항목)
        ("901Y009", "0", "소비자물가지수(CPI)", "2020=100", "M"),
        ("901Y009", "A01", "식료품 물가", "2020=100", "M"),
        
        # [재정/금리] 국채 금리 (재정 건전성 및 시장 금리 대용)
        ("721Y001", "5020000", "국고채(3년)", "연%", "M"),
        ("721Y001", "5050000", "국고채(10년)", "연%", "M"),
        
        # [환율] 화폐 가치
        ("731Y001", "0000001", "원/달러 환율", "원", "D"),
    ]

    status_text.info("한국은행(ECOS) 데이터 수집 중...")
    for stat, item, name, unit, cycle in targets:
        # 최근 1년치 데이터 수집 시도 (여기서는 finance.py의 로직에 따라 단건 혹은 기간 조회)
        # finance.py의 fetch_indicator는 단건(최신)을 가져오도록 설계되어 있음
        data_list = ecos.fetch_indicator(stat, item, name, unit, cycle, year=datetime.now().year)
        if data_list:
            indicators.extend(data_list)
    
    # 2. 글로벌 매크로 (Yahoo Finance)
    status_text.info("글로벌 매크로 데이터 수집 중...")
    macro = GlobalMacroCollector()
    indicators.extend(macro.fetch_yahoo_data())
    
    status_text.success(f"수집 완료! 총 {len(indicators)}건의 데이터가 업데이트되었습니다.")
    return indicators

# ==========================================
# 3. UI 구성 (Streamlit)
# ==========================================

# 사이드바: 설정 및 업데이트
with st.sidebar:
    st.header("⚙️ 설정")
    
    # API 키 로드 시도
    default_key = ""
    if os.path.exists(API_KEY_FILE):
        try:
            with open(API_KEY_FILE, "r") as f:
                default_key = json.load(f).get("ECOS_API_KEY", "")
        except:
            pass
            
    api_key = st.text_input("ECOS API Key", value=default_key, type="password")
    
    if st.button("🔄 데이터 업데이트 (Scraping)"):
        with st.spinner('데이터를 수집하고 있습니다...'):
            new_data = fetch_latest_data(api_key)
            if new_data:
                save_data(new_data)
                st.rerun() # 화면 새로고침

    st.markdown("---")
    st.markdown("**Data Sources:**\n- 한국은행 ECOS\n- Yahoo Finance")

# 메인 화면
st.title("📊 MoneyView 경제 지표 대시보드")
st.markdown("통화량, 재정(국채), 물가 데이터를 추적하여 경제 리스크를 모니터링합니다.")

# 데이터 로드
df = load_data()

if df.empty:
    st.warning("저장된 데이터가 없습니다. 사이드바에서 '데이터 업데이트'를 눌러주세요.")
else:
    # 탭 구성
    tab1, tab2, tab3, tab4 = st.tabs(["💰 통화/유동성", "📉 물가/인플레이션", "🏛️ 재정/국채", "📋 전체 데이터"])

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

    # 공통 그래프 그리기 함수
    def plot_metric(category_filter, title):
        # 카테고리나 이름으로 필터링 (여기서는 이름 기반으로 단순화)
        filtered_df = df[df['name'].str.contains(category_filter) | df['category'].str.contains(category_filter)]
        if not filtered_df.empty:
            fig = px.line(filtered_df, x='date', y='value', color='name', markers=True,
                          title=title, labels={'value': '값', 'date': '날짜'})
            st.plotly_chart(fig, use_container_width=True)
        else:
            st.info(f"{title} 관련 데이터가 아직 없습니다.")

    with tab1:
        st.subheader("통화 유동성 (Monetary)")
        st.markdown("**핵심 지표:** M2 통화량, 환율")
        
        # M2 증가율 계산
        m2_growth = calculate_yoy(df, "M2(평잔)")

        col1, col2 = st.columns(2)
        with col1:
            plot_metric("M2", "M2 통화량 추이")
            if not m2_growth.empty:
                fig_growth = px.line(m2_growth, x='date', y='value', markers=True,
                                     title="M2 통화량 증가율 (YoY)", labels={'value': '증가율 (%)'})
                st.plotly_chart(fig_growth, use_container_width=True)
            else:
                st.info("M2 증가율을 계산하기 위한 데이터가 부족합니다 (최소 13개월 필요).")

        with col2:
            plot_metric("원/달러", "원/달러 환율 추이")
        
        st.markdown("### 📋 상세 데이터 (통화)")
        st.dataframe(df[df['name'].str.contains("M2|환율")].sort_values(by='date', ascending=False), use_container_width=True)
            
    with tab2:
        st.subheader("인플레이션 (Inflation)")
        st.markdown("**핵심 지표:** 소비자물가지수(CPI), 식료품 물가")
        
        col1, col2 = st.columns(2)
        with col1:
            plot_metric("소비자물가지수", "소비자물가지수(CPI) 추이")
        with col2:
            # 물가 상승률 (Inflation Rate)
            cpi_growth = calculate_yoy(df, "소비자물가지수(CPI)")
            if not cpi_growth.empty:
                fig_cpi = px.line(cpi_growth, x='date', y='value', markers=True, 
                                  title="소비자물가 상승률 (YoY)", labels={'value': '상승률 (%)'})
                st.plotly_chart(fig_cpi, use_container_width=True)
            else:
                st.info("물가 상승률을 계산하기 위한 데이터가 부족합니다.")
        
        st.markdown("### 📋 상세 데이터 (물가)")
        st.dataframe(df[df['name'].str.contains("물가")].sort_values(by='date', ascending=False), use_container_width=True)

    with tab3:
        st.subheader("재정 및 금리 (Fiscal & Rates)")
        st.markdown("**핵심 지표:** 국고채 금리 (재정 부담 및 시장 금리)")
        
        # 국채 및 글로벌 금리
        plot_metric("국고채", "국고채 금리 추이")
        plot_metric("미국 10년물", "미국 국채 금리 (글로벌 벤치마크)")
        
        st.markdown("### 📋 상세 데이터 (금리)")
        st.dataframe(df[df['name'].str.contains("국고채|미국")].sort_values(by='date', ascending=False), use_container_width=True)

    with tab4:
        st.subheader("Raw Data")
        st.dataframe(df.sort_values(by=['date', 'name'], ascending=False), use_container_width=True)
        
        # CSV 다운로드 버튼
        csv = df.to_csv(index=False).encode('utf-8-sig')
        st.download_button("CSV 다운로드", csv, "economic_data.csv", "text/csv")