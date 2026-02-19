import streamlit as st
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import pandas as pd
from utils import calculate_yoy
from functools import reduce
from utils import parse_quarterly_date

def render(df):
    st.subheader("인플레이션의 본질 (Inflation Mechanics)")
    st.markdown("> **\"주가가 올라 M2가 늘어난 것이 아니라, M2가 늘어 주가가 오른 것이다.\"**")
    
    # 1. M2 통화량, CPI (시차 상관관계) vs 한국 기준 금리
    # M2(평잔)M (월별) 데이터를 우선 찾고, 없으면 포함 검색
    m2_df = df[df['name'] == "M2(평잔)M"].copy()
    if m2_df.empty:
        m2_df = df[df['name'].str.contains("M2") & df['name'].str.contains("평잔")].copy()

    if not m2_df.empty:
        m2_df['date'] = pd.to_datetime(m2_df['date'])
        m2_df = m2_df.sort_values('date')
        
        # M2 총량 그대로 사용 (증가율 계산 제외)
        m2_df['name'] = "M2 총량(십억원)"
        m2_growth = m2_df.dropna(subset=['value'])
    else:
        m2_growth = pd.DataFrame()

    cpi_growth = calculate_yoy(df, "CPI(총지수)")
    base_rate = df[df['name'] == "한국은행 기준금리"].sort_values('date').copy()
    
    if not base_rate.empty:
        base_rate['date'] = pd.to_datetime(base_rate['date'])
        # 날짜 매칭을 위해 월초(MS) 기준으로 리샘플링
        base_rate = base_rate.set_index('date').resample('MS').last().reset_index()
        base_rate.rename(columns={'value': '한국은행 기준금리(%)'}, inplace=True)
    
    dfs_to_merge_1 = []
    y_cols_1 = []
    if not m2_growth.empty:
        dfs_to_merge_1.append(m2_growth[['date', 'value']].rename(columns={'value': 'M2 총량(십억원)'}))
        y_cols_1.append('M2 총량(십억원)')
    if not cpi_growth.empty:
        dfs_to_merge_1.append(cpi_growth[['date', 'value']].rename(columns={'value': 'CPI 상승률(YoY %)'}))
        y_cols_1.append('CPI 상승률(YoY %)')
    if not base_rate.empty:
        dfs_to_merge_1.append(base_rate[['date', '한국은행 기준금리(%)']])
        y_cols_1.append('한국은행 기준금리(%)')

    if dfs_to_merge_1:
        merged_inf = reduce(lambda left, right: pd.merge(left, right, on='date', how='outer'), dfs_to_merge_1).sort_values('date')
        
        if not merged_inf.dropna(how='all', subset=y_cols_1).empty:
            # 이중 축 그래프 생성 (M2: 좌측, CPI/금리: 우측)
            fig_inf = make_subplots(specs=[[{"secondary_y": True}]])

            for col in y_cols_1:
                is_m2 = "M2" in col
                fig_inf.add_trace(
                    go.Scatter(x=merged_inf['date'], y=merged_inf[col], name=col),
                    secondary_y=not is_m2,
                )
            
            fig_inf.update_layout(title_text="통화량 공급(M2)과 물가(CPI)의 시차 상관관계")
            fig_inf.update_xaxes(title_text="날짜")
            fig_inf.update_yaxes(title_text="M2 총량 (십억원)", secondary_y=False)
            fig_inf.update_yaxes(title_text="증가율/금리 (%)", secondary_y=True)

            st.plotly_chart(fig_inf, width="stretch")
            st.caption("💡 통화량(M2) 폭증 이후 시차를 두고 소비자물가(CPI)가 따라오는지 확인하십시오.")
        else:
            st.info("M2, CPI, 기준금리 데이터가 부족하거나 날짜가 맞지 않아 차트를 표시할 수 없습니다.")
    else:
        st.info("M2, CPI, 기준금리 관련 데이터가 없습니다.")
    
    # 2. 통화 유통속도 (Velocity of Money) = GDP / M2
    gdp_data = df[df['name'].str.contains("명목") & df['name'].str.contains("국내총생산")].copy()
    m2_data = df[df['name'].str.contains("M2") & df['name'].str.contains("평잔") & df['name'].str.contains("Q")].copy()


    ## DEBUG
    # df의 종류
    # st.write(f"{df['name'].unique()}")
    # st.write(f"{len(df['name'].unique())}")
    # st.write(f"GDP 데이터 개수: {len(gdp_data)}")
    # st.write(f"M2 데이터 개수: {len(m2_data)}")   
    
    if not gdp_data.empty or not m2_data.empty:
        # GDP와 M2 모두 분기(Q) 데이터여야 계산 가능
        gdp_data['date'] = gdp_data['date'].apply(parse_quarterly_date)
        m2_data['date'] = m2_data['date'].apply(parse_quarterly_date)

        merged_vel = pd.merge(gdp_data, m2_data, on='date', how='inner', suffixes=('_GDP', '_M2'))
        
        if not merged_vel.empty:
            # 통화 유통속도 = 명목GDP(연율화) / M2 (분기평균)
            merged_vel['velocity'] = (merged_vel['value_GDP'] * 4) / merged_vel['value_M2']
            fig_vel = px.line(merged_vel, x='date', y='velocity', markers=True,
                              title="통화 유통속도 (Velocity of Money)",
                              labels={'velocity': '유통속도', 'date': '날짜'})
            st.plotly_chart(fig_vel, width="stretch")
            st.caption("💡 유통속도가 낮은데 물가가 오른다면 '스태그플레이션' 신호일 수 있습니다.")
        else:
            st.info("통화 유통속도 계산 실패: GDP(분기)와 M2 데이터의 날짜가 일치하지 않습니다.")
    else:
        missing = []
        if gdp_data.empty: missing.append("명목 국내총생산(분기)")
        if m2_data.empty: missing.append("M2(평잔)Q")
        st.info(f"통화 유통속도 계산을 위한 데이터가 부족합니다. (필요 데이터: {', '.join(missing)})")

    st.markdown("---")
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.subheader("🇰🇷 한국 금리와 물가")
        # 한국 국고채 3년물 & CPI YoY 비교
        kr_rate = df[df['name'].str.contains("국고채\(3년")].copy()
        kr_cpi = calculate_yoy(df, "CPI(총지수)")
        
        dfs_to_merge_kr = []
        y_cols_kr = []
        if not kr_rate.empty:
            dfs_to_merge_kr.append(kr_rate[['date', 'value']].rename(columns={'value': '국고채 3년(%)'}))
            y_cols_kr.append('국고채 3년(%)')
        if not kr_cpi.empty:
            dfs_to_merge_kr.append(kr_cpi[['date', 'value']].rename(columns={'value': 'CPI 상승률(YoY %)'}))
            y_cols_kr.append('CPI 상승률(YoY %)')

        if dfs_to_merge_kr:
            merged_kr = reduce(lambda left, right: pd.merge(left, right, on='date', how='outer'), dfs_to_merge_kr).sort_values('date')
            if not merged_kr.dropna(how='all', subset=y_cols_kr).empty:
                fig_kr = px.line(merged_kr, x='date', y=y_cols_kr,
                                 title="한국 국채 금리 vs 물가 상승률",
                                 labels={'value': '지표 값', 'date': '날짜', 'variable': '구분'})
                st.plotly_chart(fig_kr, width="stretch")
        else:
            st.info("한국 금리 및 물가 데이터가 부족합니다.")

    with col2:
        st.subheader("🇺🇸 미국 매크로 (금리 & 인플레)")
        # 미국 데이터: 3년물 국채, 기준금리, CPI
        us_10y = df[df['name'].str.contains("미국 3년물")].copy()
        us_base = df[df['name'].str.contains("미국 기준금리")].copy()
        us_cpi = calculate_yoy(df, "미국 CPI") # CPI Index -> YoY 변환 필요
        us_tips = df[df['name'].str.contains("미국 10년물 TIPS")].copy()
        
        # 데이터 병합을 위한 준비
        dfs_to_merge = []
        if not us_10y.empty:
            us_10y['date'] = pd.to_datetime(us_10y['date'])
            # 일별 데이터를 월 평균으로 리샘플링 (월초 기준 정렬)
            us_10y = us_10y.set_index('date').resample('MS')['value'].mean().reset_index()
            us_10y = us_10y.rename(columns={'value': '미국 3년물(%)'})
            dfs_to_merge.append(us_10y)
        if not us_base.empty:
            us_base['date'] = pd.to_datetime(us_base['date'])
            us_base = us_base[['date', 'value']].rename(columns={'value': '미국 기준금리(%)'})
            dfs_to_merge.append(us_base)
        if not us_cpi.empty:
            us_cpi['date'] = pd.to_datetime(us_cpi['date'])
            us_cpi = us_cpi[['date', 'value']].rename(columns={'value': '미국 CPI(YoY %)'})
            dfs_to_merge.append(us_cpi)
        if not us_tips.empty:
            us_tips['date'] = pd.to_datetime(us_tips['date'])
            us_tips = us_tips.set_index('date').resample('MS')['value'].mean().reset_index()
            us_tips = us_tips.rename(columns={'value': '미국 10년물 TIPs(%)'})
            dfs_to_merge.append(us_tips)
            
        if dfs_to_merge:
            merged_us = reduce(lambda left, right: pd.merge(left, right, on='date', how='outer'), dfs_to_merge).sort_values('date')
            
            # 차트
            fig_us = px.line(merged_us, x='date', y=merged_us.columns.drop('date'),
                             title="미국 금리 및 인플레이션 추이",
                             labels={'value': '값', 'date': '날짜', 'variable': '지표'})
            st.plotly_chart(fig_us, width="stretch")
            
            # 표 (최근 데이터 역순)
            st.markdown("**최근 데이터 (Table)**")
            display_df = merged_us.sort_values('date', ascending=False).head(10).copy()
            display_df['date'] = display_df['date'].dt.strftime('%Y-%m-%d')
            st.dataframe(display_df.style.format("{:.2f}", subset=display_df.columns.drop('date')), width="stretch")
        else:
            st.info("미국 매크로 데이터가 부족합니다. (데이터 업데이트 필요)")