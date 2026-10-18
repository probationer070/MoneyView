import sqlite3, sys, yfinance as yf
SP = sys.argv[1]
c = sqlite3.connect('file:data/processed/moneyview.db?mode=ro', uri=True)
t = [r[0] for r in c.execute("select ticker from watchlist")] + ["^SOX", "SPY"]
df = yf.download(t, start="2026-03-01", end="2026-10-18", auto_adjust=True, progress=False)["Close"]
df.to_csv(f"{SP}/wl_px.csv"); print(df.shape)
