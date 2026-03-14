import streamlit as st
import requests
import plotly.graph_objects as go

def get_crypto_fng():
    try:
        # 1. CoinMarketCap API 시도 (API Key가 있는 경우)
        cmc_key = st.session_state.get('cmc_api_key')
        if cmc_key:
            url = "https://pro-api.coinmarketcap.com/v3/fear-and-greed/latest"
            headers = {
                'X-CMC_PRO_API_KEY': cmc_key,
                'Accept': 'application/json'
            }
            r = requests.get(url, headers=headers, timeout=5)
            r.raise_for_status()
            data = r.json()
            
            if 'data' in data:
                latest = data['data']
                # 사용자 응답 예시: {"data": {"value ": 40, ...}} (리스트가 아닌 객체)
                # 키값에 공백이 포함된 경우("value ")와 정상적인 경우("value") 모두 대응
                val = latest.get('value')
                if val is None:
                    val = latest.get('value ')
                
                if val is not None:
                    return int(val), latest.get('value_classification', 'Neutral')
    except Exception as e:
        st.error(f"CMC API 호출에 실패했습니다: {e}")
        return None, "Error"

    # API 키가 없거나, API 호출은 성공했지만 데이터 파싱에 실패한 경우
    if not st.session_state.get('cmc_api_key'):
        st.warning("CMC API 키가 제공되지 않았습니다. 사이드바에서 키를 입력해주세요.")
    else:
        st.error("CMC API에서 데이터를 가져오지 못했습니다. 응답 형식을 확인해주세요.")
        
    return None, "Error"

def get_cnn_fng():
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept': 'application/json'
        }
        url = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata'
        r = requests.get(url, headers=headers, timeout=5)
        data = r.json()
        val = int(data['fear_and_greed']['score'])
        desc = data['fear_and_greed']['rating']
        return val, desc.title()
    except Exception as e:
        return None, "Error"

def create_gauge(title, value, desc):
    if value is None:
        return None
    
    fig = go.Figure(go.Indicator(
        mode = "gauge+number",  # delta 제거로 '-' 표시 삭제
        value = value,
        title = {'text': f"<b>{title}</b>", 'font': {'size': 40}},
        gauge = {
            'axis': {'range': [0, 100], 'tickwidth': 2},
            'bar': {'color': "black", 'thickness': 0.2}, # 바 두께 조절 가능
            'bgcolor': "white",
            'steps': [
                {'range': [0, 25], 'color': "rgba(255, 0, 0, 0.6)"}, # Extreme Fear
                {'range': [25, 45], 'color': "rgba(255, 165, 0, 0.6)"}, # Fear
                {'range': [45, 55], 'color': "rgba(200, 200, 200, 0.6)"}, # Neutral
                {'range': [55, 75], 'color': "rgba(144, 238, 144, 0.6)"}, # Greed
                {'range': [75, 100], 'color': "rgba(0, 128, 0, 0.6)"}  # Extreme Greed
            ],
            'threshold': {
                'line': {'color': "black", 'width': 4},
                'thickness': 0.75,
                'value': value
            }
        }
    ))
    
    fig.update_layout(
        # 전체 캔버스 안에서 그래프 위치와 여백 조정
        margin=dict(l=40, r=40, t=80, b=40),
        annotations=[
            dict(
                text=f"<b>{desc}</b>",
                x=0.5,
                y=-0.07,  # 숫자 바로 밑 위치
                showarrow=False,
                font=dict(size=22),
            ),
        ],
        paper_bgcolor="rgba(0,0,0,0)", # 배경 투명하게 (필요시)
        plot_bgcolor="rgba(0,0,0,0)",
        height=350
    )
    return fig

def render(df=None):
    st.markdown("### 😨 공포/탐욕 지수 (Fear & Greed Index)")
    st.markdown("자산 시장(S&P 500, Crypto)의 투자 심리와 센티멘트를 확인합니다.")
    
    col1, col2 = st.columns(2)
    
    with st.spinner("지수 데이터를 불러오는 중..."):
        cnn_val, cnn_desc = get_cnn_fng()
        crypto_val, crypto_desc = get_crypto_fng()
        
    with col1:
        with st.container(border=True):
            if cnn_val is not None:
                fig1 = create_gauge("CNN Fear & Greed", cnn_val, cnn_desc)
                st.plotly_chart(fig1, width='stretch', key="cnn_gauge", config={'displayModeBar': False})
            else:
                st.error("데이터를 불러올 수 없습니다.")
                
    with col2:
        with st.container(border=True):
            # st.markdown("#### Crypto (Alternative.me)")
            if crypto_val is not None:
                fig2 = create_gauge("Crypto Fear & Greed", crypto_val, crypto_desc)                
                st.plotly_chart(fig2, width='stretch', key="crypto_gauge", config={'displayModeBar': False})
            else:
                st.error("데이터를 불러올 수 없습니다.")
