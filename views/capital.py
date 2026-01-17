import streamlit as st
import plotly.express as px
from utils import plot_metric

def render(df):
    st.subheader("자본 유출과 멀티커런시 전략")
    st.markdown("**'아시아 자본의 이동'과 개인의 탈출 속도**")
    
    col1, col2 = st.columns(2)
    with col1:
        # 3국 금리 비교
        yields = df[df['name'].str.contains("국고채\(10년\)|미국 10년물|일본 국채 10년물")]
        if not yields.empty:
            fig_yields = px.line(yields, x='date', y='value', color='name',
                                 title="한·미·일 국채 10년물 금리 비교", labels={'value': '금리(%)'})
            st.plotly_chart(fig_yields, use_container_width=True)
            
    with col2:
        plot_metric(df, "거주자외화예금", "거주자 외화예금 잔액 (달러 선호도)")
        st.caption("💡 이 수치가 급증한다면 스마트 머니가 원화를 버리고 달러로 이동 중이라는 신호입니다.")