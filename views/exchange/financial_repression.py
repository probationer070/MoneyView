import streamlit as st
import pandas as pd

def render(df):
    st.subheader("금융 억압 및 자본 통제 지표")
    st.markdown("**정부의 인위적인 자본 유출 방어 및 민간 통제 시도**")

    col1, col2 = st.columns(2)

    with col1:
        # 기업 외화 환전 비율 (데이터 부재 시 안내)
        st.markdown("##### 1. 기업 외화 예금/환전 동향")
        corp_forex = df[df['name'].str.contains("거주자 외화예금")].copy() # 대용 지표
        
        if not corp_forex.empty:
            st.line_chart(corp_forex.set_index('date')['value'])
            st.caption("💡 거주자 외화예금 증가는 환전 유보(달러 보유) 심리를 나타냅니다.")
        else:
            st.info("외화 예금 데이터가 없습니다.")

    with col2:
        # 해외 송금/투자 규제 뉴스 (RiskNews 활용)
        st.markdown("##### 2. 자본 통제 관련 뉴스/규제")
        # RiskNews 데이터는 df에 없으므로, 여기서는 안내 문구만 표시
        st.info("금융감독원/금융위원회 보도자료 크롤링 결과가 이곳에 표시됩니다. (현재 데이터 연동 필요)")
        
    # 서학개미 규제 모니터링
    st.markdown("##### 3. 개인 해외 투자(서학개미) 자금 추이")
    retail_foreign = df[df['name'].str.contains("해외주식") | df['name'].str.contains("외화증권")].copy()
    
    if not retail_foreign.empty:
        st.bar_chart(retail_foreign.set_index('date')['value'])
    else:
        st.info("해외 주식 결제/보유 데이터가 없습니다.")