import streamlit as st
import yfinance as yf
import pandas as pd
import plotly.graph_objects as go
import os

INDICES = {
    "S&P 500": "^GSPC",
    "Dow Jones": "^DJI",
    "Nasdaq": "^IXIC",
    "KOSPI 200": "^KS200",
    "Gold": "GC=F",
    "Oil (WTI)": "CL=F",
    "Natural Gas": "NG=F",
    "USD/KRW": "KRW=X",
    "Bitcoin": "BTC-USD"
}

def load_or_fetch_index_data(name, ticker, period="1y"):
    save_dir = "src/indices"
    os.makedirs(save_dir, exist_ok=True)
    save_path = os.path.join(save_dir, f"{name.replace('/', '_')}.csv")
    
    # Try fetching latest
    try:
        ticker_obj = yf.Ticker(ticker)
        df = ticker_obj.history(period=period)
        if not df.empty:
            df.reset_index(inplace=True)
            if 'Date' not in df.columns and 'Datetime' in df.columns:
                df.rename(columns={'Datetime': 'Date'}, inplace=True)
            if 'Date' in df.columns:
                df['Date'] = pd.to_datetime(df['Date'])
                if df['Date'].dt.tz is not None:
                    df['Date'] = df['Date'].dt.tz_localize(None)
            df.to_csv(save_path, index=False)
            return df
    except Exception as e:
        print(f"Error fetching {ticker}: {e}")
    
    # Fallback to local
    if os.path.exists(save_path):
        try:
            df = pd.read_csv(save_path, parse_dates=["Date"])
            return df
        except Exception:
            return None
        
    return None

def create_mini_chart(df, name):
    if df is None or df.empty:
        return None
    
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=df['Date'],
        y=df['Close'],
        mode='lines',
        name=name,
        line=dict(width=2, color='#1f77b4'),
        fill='tozeroy',
        fillcolor='rgba(31, 119, 180, 0.1)'
    ))
    
    # Current value and change
    last_val = df['Close'].iloc[-1]
    prev_val = df['Close'].iloc[-2] if len(df) > 1 else last_val
    change = last_val - prev_val
    pct_change = (change / prev_val) * 100 if prev_val != 0 else 0
    
    color = "green" if change >= 0 else "red"
    pct_str = f"+{pct_change:.2f}%" if change >= 0 else f"{pct_change:.2f}%"
    
    fig.update_layout(
        title=dict(
            text=f"<b>{name}</b><br><span style='font-size:18px'>{last_val:,.2f} <span style='color:{color}'>({pct_str})</span></span>",
            x=0.05,
            y=0.9,
            xanchor='left',
            yanchor='top'
        ),
        title_font_size=14,
        margin=dict(l=10, r=10, t=60, b=10),
        height=200,
        xaxis=dict(visible=False, showgrid=False),
        yaxis=dict(visible=False, showgrid=False),
        plot_bgcolor="rgba(0,0,0,0)",
        paper_bgcolor="rgba(0,0,0,0)",
        showlegend=False
    )
    return fig

def render(df=None):
    st.markdown("### 📈 글로벌 기초 지표 (Fundamentals)")
    st.markdown("주요 글로벌 금융 지표를 한 화면에서 확인합니다.")
    
    # Fetch data
    with st.spinner("지표 데이터를 불러오는 중..."):
        data_dict = {}
        for name, ticker in INDICES.items():
            data_dict[name] = load_or_fetch_index_data(name, ticker)
            
    # Display in a 3x3 grid
    for i in range(0, 9, 3):
        cols = st.columns(3)
        for j in range(3):
            if i + j < len(INDICES):
                name = list(INDICES.keys())[i+j]
                df_index = data_dict.get(name)
                with cols[j]:
                    with st.container(border=True):
                        fig = create_mini_chart(df_index, name)
                        if fig:
                            st.plotly_chart(fig, width='stretch', key=f"chart_{name}", config={'displayModeBar': False})
                        else:
                            st.warning(f"{name} 데이터 없음")
