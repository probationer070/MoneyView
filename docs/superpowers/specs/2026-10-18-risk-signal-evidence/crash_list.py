import sqlite3, json, sys
import yfinance as yf
SP = sys.argv[1]
c = sqlite3.connect('file:data/processed/moneyview.db?mode=ro', uri=True)
wl = {t: (n, s) for t, n, s in c.execute("select ticker,name,sector from watchlist")}
extra = {"NVDA": ("NVIDIA","Semiconductor"), "MU": ("Micron","Semiconductor"), "ASML": ("ASML","Semiconductor"),
         "TSM": ("TSMC","Semiconductor"), "CRWV": ("CoreWeave","AI infra"), "NBIS": ("Nebius","AI infra"),
         "PLTR": ("Palantir","Technology"), "005930.KS": ("삼성전자","Semiconductor"), "000660.KS": ("SK하이닉스","Semiconductor")}
uni = {**extra, **wl}
df = yf.download(list(uni), start="2026-07-15", end="2026-10-18", auto_adjust=True, progress=False)["Close"]
rows = []
for t in uni:
    if t not in df or df[t].dropna().empty: continue
    s = df[t].dropna()
    try:
        p0 = s.loc[:"2026-10-06"].iloc[-1]; p1 = s.iloc[-1]
    except IndexError: continue
    pk = s.loc["2026-08-01":]; pkd = pk.idxmax()
    rows.append(dict(t=t, name=uni[t][0], sector=uni[t][1], wl=t in wl,
        chg=round((p1/p0-1)*100,1), from_peak=round((p1/pk.max()-1)*100,1), peak=pkd.strftime("%m/%d"), last=s.index[-1].strftime("%m/%d")))
rows.sort(key=lambda r: r["chg"])
json.dump(rows, open(f"{SP}/crash.json","w",encoding="utf-8"), ensure_ascii=False)
print(len(uni), len(rows))
for r in rows[:30]: print(r)
print("...", rows[-5:])
