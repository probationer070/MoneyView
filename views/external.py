import streamlit as st
import plotly.express as px
import pandas as pd

def render(df):
    st.subheader("외환 및 대외 건전성")
    st.markdown("**환율 1,450원 돌파와 외환보유고 고갈 리스크 모니터링**")
    
    col1, col2 = st.columns(2)
    with col1:
        # 외환보유액 구성 (현금 vs 유가증권)
        reserves = df[df['name'].str.contains("외환보유액")].copy()
        if not reserves.empty:
            fig_res = px.area(reserves, x='date', y='value', color='name',
                              title="외환보유액 구성 (유동성 확인)", labels={'value': '천달러'})
            st.plotly_chart(fig_res, use_container_width=True)
            st.caption("💡 위기 시 즉시 쓸 수 있는 '예치금(Deposits)' 비중이 중요합니다.")
            
    with col2:
        # CDS 프리미엄 대체: 한-미 금리 스프레드
        kr_10y = df[df['name'].str.contains("국고채\(10년")].set_index('date')['value']
        us_10y = df[df['name'].str.contains("미국 10년물")].set_index('date')['value']
        
        if not kr_10y.empty and not us_10y.empty:
            spread = (kr_10y - us_10y).dropna().rename("한-미 금리차(bp)") * 100 # bp 단위
            fig_spread = px.line(spread, title="국가 리스크 프리미엄 (한-미 국채 10년 스프레드)",
                                 labels={'value': 'Spread (bp)'})
            fig_spread.add_hline(y=0, line_dash="dash", line_color="red")
            st.plotly_chart(fig_spread, use_container_width=True)
            st.caption("💡 금리차가 역전(음수)되거나 급격히 벌어지는 구간은 자본 유출 위험 구간입니다.")