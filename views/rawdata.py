import streamlit as st

def render(df):
    st.subheader("전체 데이터 (Raw Data)")
    st.dataframe(df.sort_values(by=['date', 'name'], ascending=False), width='stretch')
    
    # CSV 다운로드 버튼
    csv = df.to_csv(index=False).encode('utf-8-sig')
    st.download_button("CSV 다운로드", csv, "economic_data.csv", "text/csv")