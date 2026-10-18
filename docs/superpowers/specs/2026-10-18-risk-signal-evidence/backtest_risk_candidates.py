"""Risk-candidate backtest. Signals use only data on or before the as-of date."""
import sqlite3, sys, json
import pandas as pd
SP = sys.argv[1]
px = pd.read_csv(f"{SP}/wl_px.csv", index_col=0, parse_dates=True)
c = sqlite3.connect('file:data/processed/moneyview.db?mode=ro', uri=True)
sector = dict(c.execute("select ticker, sector from watchlist"))
names = [t for t in px.columns if t in sector and px[t].notna().sum() > 100]
HORIZON, FALL = 8, -10.0   # 8 trading days ahead; a "hit" is a fall of 10% or more

def evaluate(asof):
    h = px.loc[:asof]; i = px.index.get_loc(h.index[-1])
    if i + HORIZON >= len(px): return None
    fut = px.iloc[i + HORIZON]
    last = h.iloc[-1]; hi63 = h.iloc[-63:].max(); dd = (last / hi63 - 1) * 100
    ret = h.pct_change().iloc[-63:]
    rel20 = (h.iloc[-1] / h.iloc[-21] - 1) - (h["SPY"].iloc[-1] / h["SPY"].iloc[-21] - 1)
    ma20, ma50 = h.iloc[-20:].mean(), h.iloc[-50:].mean()
    rows = []
    for t in names:
        if pd.isna(last[t]) or pd.isna(fut[t]) or dd[t] <= -10: continue   # candidates: still within 10% of 3-month high
        peers = [p for p in names if sector[p] == sector[t] and p != t and not pd.isna(dd[p])]
        share = sum(dd[p] <= -20 for p in peers) / len(peers) if len(peers) >= 2 else 0.0
        s1 = bool(share >= 0.5)
        s2 = bool(last[t] < ma20[t] or last[t] < ma50[t] or rel20[t] < 0)
        corr = max(ret[t].corr(ret["^SOX"]), max((ret[t].corr(ret[p]) for p in names if p != t and dd[p] <= -20), default=0))
        s3 = bool(corr >= 0.6)
        rows.append(dict(t=t, sector=sector[t], dd=round(dd[t], 1), share=round(share, 2), corr=round(corr, 2),
                         s1=s1, s2=s2, s3=s3, score=int(s1) + int(s2) + int(s3), out=round((fut[t] / last[t] - 1) * 100, 1)))
    return pd.DataFrame(rows)

def summarize(df, label):
    hit = df.out <= FALL
    out = {"asof": label, "n": len(df), "base_hit": round(hit.mean() * 100, 1), "base_avg": round(df.out.mean(), 1)}
    for k in ["s1", "s2", "s3"]:
        m = df[k]; out[k] = (int(m.sum()), round(hit[m].mean() * 100, 1) if m.any() else None, round(hit[~m].mean() * 100, 1) if (~m).any() else None)
    for s in range(4):
        m = df.score == s; out[f"score{s}"] = (int(m.sum()), round(hit[m].mean() * 100, 1) if m.any() else None, round(df.out[m].mean(), 1) if m.any() else None)
    return out

main = evaluate("2026-10-06")
print("== as of 10/06, outcome 10/16 ==")
print(json.dumps(summarize(main, "10/06"), ensure_ascii=False))
print(main.sort_values(["score", "out"], ascending=[False, True]).to_string(index=False))
main.to_csv(f"{SP}/bt_main.csv", index=False)
print("== weekly as-of dates (false-alarm check) ==")
weekly = []
for d in pd.date_range("2026-07-06", "2026-10-06", freq="W-MON"):
    r = evaluate(d)
    if r is not None and len(r): s = summarize(r, d.strftime("%m/%d")); weekly.append(s); print(json.dumps(s, ensure_ascii=False))
json.dump(weekly, open(f"{SP}/bt_weekly.json", "w"), ensure_ascii=False)
