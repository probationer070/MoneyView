import streamlit as st
import requests
import plotly.graph_objects as go

def get_crypto_fng():
    try:
        r = requests.get('https://api.alternative.me/fng/?limit=1', timeout=5)
        data = r.json()
        val = int(data['data'][0]['value'])
        desc = data['data'][0]['value_classification']
        return val, desc
    except Exception as e:
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
        mode = "gauge+number+delta",
        value = value,
        title = {'text': f"<b>{title}</b><br><span style='font-size:0.8em;color:gray'>{desc}</span>"},
        gauge = {
            'axis': {'range': [0, 100], 'tickwidth': 1, 'tickcolor': "darkblue"},
            'bar': {'color': "rgba(0,0,0,0)", 'thickness': 0},
            'bgcolor': "white",
            'borderwidth': 2,
            'bordercolor': "gray",
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
        margin=dict(l=20, r=20, t=50, b=20),
        height=300
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
            st.markdown("#### S&P 500 (CNN)")
            if cnn_val is not None:
                fig1 = create_gauge("CNN Fear & Greed", cnn_val, cnn_desc)
                st.plotly_chart(fig1, width='stretch', key="cnn_gauge", config={'displayModeBar': False})
            else:
                st.error("데이터를 불러올 수 없습니다.")
                
    with col2:
        with st.container(border=True):
            st.markdown("#### Crypto (Alternative.me)")
            if crypto_val is not None:
                fig2 = create_gauge("Crypto Fear & Greed", crypto_val, crypto_desc)
                st.plotly_chart(fig2, width='stretch', key="crypto_gauge", config={'displayModeBar': False})
            else:
                st.error("데이터를 불러올 수 없습니다.")
