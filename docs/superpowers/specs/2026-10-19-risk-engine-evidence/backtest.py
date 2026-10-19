"""Risk-alert threshold backtest (risk-signal sub-project 2, first task). Research only.

Reads bt2/cache/ (made by fetch_data.py + fetch_hy_proxy.py). Writes bt2/out/run.pkl and bt2/results.json.
Run (from any dir):  python bt2/fetch_data.py; python bt2/fetch_hy_proxy.py; python bt2/backtest.py; python bt2/report.py
"""
import itertools
import json
import pickle
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
C = HERE / "cache"
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)

SEMI = {"ai_semis", "memory_storage", "chip_equipment_design", "optical_connectivity", "analog_power_chips"}
EXCLUDED_THEMES = {"defensives_other"}  # R-D17: not a group -> never triggers
EVAL_START = pd.Timestamp("2016-01-04")
ACC_DAY = pd.Timestamp("2026-10-08")
BASE = dict(w1_vel=0.30, w1_lvl=3.50, w2_lvl=5.00, w2_vel=0.40, w3=0.15, w4_days=60,
            w5=0.0030, w6_share=0.40, w7=0.05)
STEPS = dict(w1_vel=0.05, w1_lvl=0.25, w2_lvl=0.25, w2_vel=0.10, w3=0.05, w4_days=30,
             w5=0.0005, w6_share=0.20, w7=0.02)
RELEASE = dict(recover=0.03, quiet_days=15)
GRID = list(itertools.product([3, 4, 5, 6], [1, 2, 3], [0, 1, 2, 3]))
WNAMES = ["W1", "W2", "W3", "W4", "W5", "W6", "W7"]


# ---------------------------------------------------------------- data
def load_prices():
    """DB closes (split-adjusted, checked on NVDA 2024-06-10 / AVGO 2024-07-15), extended before the DB's
    first bar and after its last bar with yfinance auto-adjusted closes rescaled to meet the DB close."""
    yc = pd.read_csv(C / "yf_close.csv", index_col=0, parse_dates=True)
    cal = yc["SPY"].dropna().index
    cal = cal[cal >= "2015-06-01"]
    db = pd.read_csv(C / "db_close.csv", index_col=0, parse_dates=True).reindex(cal)
    out = {}
    for t in db.columns:
        s = db[t].copy()
        first, last = s.first_valid_index(), s.last_valid_index()
        if t in yc.columns and first is not None:
            y = yc[t].reindex(cal)
            if pd.notna(y.get(first)):
                head = y[y.index < first] / y[first] * s[first]
                s[head.index] = head
            if pd.notna(y.get(last)):
                tail = y[y.index > last] / y[last] * s[last]
                s[tail.index] = tail
        out[t] = s
    return pd.DataFrame(out), yc[["^SOX", "RSP", "SPY"]].reindex(cal), cal


def theme_indices(px, wl, shares):
    """Cap-weighted, chain-linked: day-t return = sum(w_i r_i)/sum(w_i), w_i = shares_now_i * close_i,t-1,
    over members with closes on t-1 and t. NaN on days with <3 such members (R-B5)."""
    rets = px.pct_change(fill_method=None)
    capprev = px.shift(1) * shares.reindex(px.columns)
    levels, counts = {}, {}
    for th, members in wl.groupby("theme").ticker:
        m = [t for t in members if t in px.columns and pd.notna(shares.get(t))]
        r = rets[m]
        w = capprev[m].where(r.notna())
        n = r.notna().sum(axis=1)
        ret = (w * r).sum(axis=1) / w.sum(axis=1)
        lvl, cur, started = np.full(len(ret), np.nan), 100.0, False
        for i, (ok, rr) in enumerate(zip((n >= 3).values, ret.values)):
            if ok:
                cur = cur * (1 + rr) if started else 100.0
                started = True
                lvl[i] = cur
        levels[th], counts[th] = pd.Series(lvl, index=px.index), n
    return pd.DataFrame(levels), pd.DataFrame(counts)


def fred(s):
    return pd.read_csv(C / f"fred_{s}.csv", index_col=0, parse_dates=True)["value"].sort_index()


def on_calendar(series, cal, lag_days=1):
    """Daily FRED value known at trading-day t's close = last observation dated <= t - 1 business day
    (FRED posts day-t values the next morning)."""
    s = series.sort_index()
    s2 = pd.Series(s.values, index=s.index + pd.tseries.offsets.BDay(lag_days))
    s2 = s2[~s2.index.duplicated(keep="last")]
    return s2.reindex(cal.union(s2.index)).ffill().reindex(cal)


def monthly_known(series, cal, release_offset):
    """m/m change of month M, known from release_offset(M) on."""
    mm = series.sort_index().pct_change()
    k = pd.Series(mm.values, index=[release_offset(d) for d in mm.index]).dropna()
    k = k[~k.index.duplicated(keep="last")]
    return k.reindex(cal.union(k.index)).ffill().reindex(cal)


def hy_proxy_params(p):
    """FRED serves BAMLH0A0HYM2 only for the last 3 years (ICE licence; first obs 2023-10-17), so W1
    before that uses Moody's BAA10Y. Calibrated on the 2023-10..2026-10 overlap:
      velocity: BAA10Y 10-day change threshold set so it is on as often as 'HY 10d change >= w1_vel';
      level: HY ~ a + b*BAA10Y (overlap OLS) inverted at w1_lvl."""
    hy, baa = fred("BAMLH0A0HYM2"), fred("BAA10Y")
    df = pd.concat([hy.rename("hy"), baa.rename("baa")], axis=1).dropna()
    d = df.diff(10).dropna()
    share = float((d.hy >= p["w1_vel"] - 1e-9).mean())
    vel = float(d.baa.quantile(1 - share))
    b, a = np.polyfit(df.baa, df.hy, 1)
    return dict(vel=vel, lvl=float((p["w1_lvl"] - a) / b), share=share, slope=float(b), intercept=float(a),
                overlap_start=str(df.index.min().date()))


def market_warnings(cal, mkt, p):
    hy = on_calendar(fred("BAMLH0A0HYM2"), cal)
    hy_start = fred("BAMLH0A0HYM2").index.min()
    hy = hy.where(cal > hy_start + pd.Timedelta(days=20))  # need 10 obs of real HY for velocity
    baa = on_calendar(fred("BAA10Y"), cal)
    pp = hy_proxy_params(p)
    w1_real = (hy.diff(10) >= p["w1_vel"] - 1e-9) | (hy >= p["w1_lvl"] - 1e-9)
    w1_proxy = (baa.diff(10) >= pp["vel"] - 1e-9) | (baa >= pp["lvl"] - 1e-9)
    w1 = w1_real.where(hy.notna(), w1_proxy)

    dgs = on_calendar(fred("DGS10"), cal)
    w2 = (dgs >= p["w2_lvl"] - 1e-9) | (dgs.diff(20) >= p["w2_vel"] - 1e-9)
    brent = on_calendar(fred("DCOILBRENTEU"), cal)
    w3 = brent / brent.shift(20) - 1 >= p["w3"] - 1e-9

    ff = fred("DFEDTARU")
    hikes = ff.index[ff.diff() > 0]  # DFEDTARU dates the effective day (>= decision day): no look-ahead
    w4 = pd.Series(False, index=cal)
    for h in hikes:
        w4[(cal >= h) & (cal <= h + pd.Timedelta(days=p["w4_days"]))] = True

    cpi = monthly_known(fred("CPILFESL"), cal, lambda d: d + pd.DateOffset(months=1, days=14))       # 15th of M+1
    pce = monthly_known(fred("PCEPILFE"), cal, lambda d: d + pd.DateOffset(months=2) - pd.Timedelta(days=1))  # end M+1
    w5 = (cpi >= p["w5"] - 1e-12) | (pce >= p["w5"] - 1e-12)

    sox, rsp = mkt["^SOX"], mkt["RSP"]
    ratio = sox / rsp
    w7 = (ratio / ratio.rolling(60, min_periods=60).max() - 1 <= -p["w7"] + 1e-12) & \
         (sox / sox.rolling(60, min_periods=60).max() - 1 >= -0.05)
    W = pd.DataFrame({"W1": w1, "W2": w2, "W3": w3, "W4": w4, "W5": w5, "W7": w7}, index=cal)
    raw = dict(hy=hy, baa=baa, dgs=dgs, brent=brent, cpi=cpi, pce=pce, ratio=ratio, proxy=pp)
    return W.fillna(False).astype(bool), raw


def w6_theme(px, wl, shares, levels, p):
    """Per theme: >= w6_share of the 5 largest members (shares_now * close that day) are >= 10% below their
    own 63-day high while the theme index is within 5% of its 63-day high."""
    caps = px * shares.reindex(px.columns)
    dd63 = px / px.rolling(63, min_periods=40).max() - 1
    out = {}
    for th, members in wl.groupby("theme").ticker:
        if th not in levels.columns:
            continue
        m = [t for t in members if t in px.columns and pd.notna(shares.get(t))]
        c, d = caps[m].values, dd63[m].values
        flag = np.zeros(len(px), bool)
        for i in range(len(px)):
            idx = np.where(~np.isnan(c[i]) & ~np.isnan(d[i]))[0]
            if len(idx) < 3:
                continue
            top = idx[np.argsort(-c[i][idx])][:5]
            need = max(1, int(np.ceil(p["w6_share"] * len(top) - 1e-9)))
            flag[i] = (d[i][top] <= -0.10).sum() >= need
        lv = levels[th]
        near = lv / lv.rolling(63, min_periods=40).max() - 1 >= -0.05
        out[th] = pd.Series(flag, index=px.index) & near
    return pd.DataFrame(out).fillna(False)


# ---------------------------------------------------------------- signals
def consec_down(level):
    out, run = np.zeros(len(level), int), 0
    for i, v in enumerate(level.diff().values):
        run = run + 1 if (not np.isnan(v) and v < 0) else 0
        out[i] = run
    return pd.Series(out, index=level.index)


def prep_shapes(levels, sox):
    sh = {}
    for name, lv in list(levels.items()) + [("^SOX", sox)]:
        sh[name] = dict(dd20=lv / lv.rolling(20, min_periods=20).max() - 1, down=consec_down(lv),
                        newlow=lv <= lv.rolling(20, min_periods=20).min() + 1e-12, valid=lv.notna())
    return sh


def confirmations(shapes, Wm, W6, X, Y, K, themes, drop=None):
    """Banner test per theme/day. `drop` = a warning name removed from the count (ablation)."""
    mcols = [c for c in Wm.columns if c != drop]
    mcount = Wm[mcols].sum(axis=1)
    conf, via = {}, {}
    for th in themes:
        w6 = W6[th].astype(int) if drop != "W6" else 0
        warn = (mcount + w6) >= K
        s = shapes[th]
        own = (s["dd20"] <= -X / 100 + 1e-12) & (s["down"] >= Y) & s["valid"]
        v = pd.Series(np.where(own, "theme", ""), index=own.index)
        c = own
        if th in SEMI:
            q = shapes["^SOX"]
            soxc = (q["dd20"] <= -X / 100 + 1e-12) & (q["down"] >= Y) & s["valid"]
            v = v.where(own, np.where(soxc, "SOX", ""))
            c = own | soxc
        conf[th] = (c & warn).fillna(False)
        via[th] = v
    return pd.DataFrame(conf), pd.DataFrame(via)


def run_alerts(conf, shapes, cal, rule):
    """R-B2: one market-wide alert at a time; themes that pass the banner test while it is open join it.
    rule "A" (brief): release when every alert theme is within 3% of its 20d high, OR 15 trading days pass
      with no new 20d low in any alert theme. Themes stay in the alert until it is released.
    rule "B" (alternative): the same two tests applied to each theme on its own (recovered within 3%, or 15
      trading days since its own last new 20d low); a theme that passes leaves the alert; the alert is
      released when no theme is left. A theme that left may re-join the same open alert.
    Status uses each theme's own index (not ^SOX). A new alert can open the day after a release."""
    alerts, cur = [], None
    Cv, cols = conf.values, list(conf.columns)
    dd = {t: shapes[t]["dd20"].values for t in cols}
    low = {t: shapes[t]["newlow"].values for t in cols}
    i0 = cal.get_loc(cal[cal >= EVAL_START][0])
    for i in range(i0, len(cal)):
        firing = [cols[j] for j in np.where(Cv[i])[0]]
        if cur is None:
            if firing:
                cur = dict(start_i=i, trigger=firing, joins={t: i for t in firing}, events=[(t, i) for t in firing],
                           active={t: i for t in firing}, last_low_i=i)
            continue
        for t in firing:
            cur["joins"].setdefault(t, i)
            if t not in cur["active"]:
                cur["active"][t] = i
                cur["events"].append((t, i))
        if i == cur["start_i"]:
            continue
        for t in cur["active"]:
            if low[t][i]:
                cur["active"][t] = i  # last new-low day
        rec = {t: bool(dd[t][i] > -RELEASE["recover"]) for t in cur["active"]}
        if rule == "A":
            if any(low[t][i] for t in cur["active"]):
                cur["last_low_i"] = i
            all_rec = all(rec.values())
            if all_rec or i - cur["last_low_i"] >= RELEASE["quiet_days"]:
                cur.update(release_i=i, reason="recovered" if all_rec else "quiet15")
                alerts.append(cur)
                cur = None
        else:
            for t in list(cur["active"]):
                if t not in firing and (rec[t] or i - cur["active"][t] >= RELEASE["quiet_days"]):
                    del cur["active"][t]
            if not cur["active"]:
                cur.update(release_i=i, reason="all themes out")
                alerts.append(cur)
                cur = None
    if cur is not None:
        cur.update(release_i=None, reason="open")
        alerts.append(cur)
    for a in alerts:
        a.pop("active", None)
    return alerts


def fwd_stats(level, i):
    v, n = level.values, len(level)
    res = {f"fwd{h}": (float(v[i + h] / v[i] - 1) if i + h < n and not np.isnan(v[i + h]) else None)
           for h in (5, 10, 20)}
    win = v[i + 1:i + 11]
    win = win[~np.isnan(win)]
    res["maxdd10"] = float(min(win.min() / v[i] - 1, 0.0)) if len(win) else None
    res["complete10"] = len(win) == 10
    return res


def find_episodes(level, depth=0.15, span=60):
    """Peak-to-trough >= depth within <= span trading days; scanning resumes after each trough (de-dup)."""
    v, n, eps, t = level.values, len(level), [], 0
    while t < n:
        w = v[t + 1:t + 1 + span]
        if np.isnan(v[t]) or len(w) == 0 or np.all(np.isnan(w)) or np.nanmin(w) / v[t] - 1 > -depth:
            t += 1
            continue
        p = t
        for _ in range(10):  # move the peak to the highest close before the trough
            tr = p + 1 + int(np.nanargmin(v[p + 1:p + 1 + span]))
            p2 = p + int(np.nanargmax(v[p:tr + 1]))
            if p2 == p:
                break
            p = p2
        tr = p + 1 + int(np.nanargmin(v[p + 1:p + 1 + span]))
        dep = v[tr] / v[p] - 1
        if dep <= -depth:
            half = next(k for k in range(p, tr + 1) if v[k] / v[p] - 1 <= dep / 2)
            eps.append(dict(peak_i=p, trough_i=tr, half_i=half, depth=float(dep)))
            t = tr + 1
        else:
            t += 1
    return eps


def evaluate(alerts, conf, levels, episodes, cal, themes, Wm, W6):
    last = len(cal) - 1
    rows = []
    for a in alerts:
        i = a["start_i"]
        per = {t: dict(joined=str(cal[ji].date()), **fwd_stats(levels[t], ji)) for t, ji in a["joins"].items()}
        trig = [per[t] for t in a["trigger"]]
        prim = min(a["trigger"], key=lambda t: float(levels[t].iloc[i] / levels[t].iloc[i - 19:i + 1].max()))
        warn = [w for w in Wm.columns if Wm[w].iloc[i]] + (["W6"] if any(W6[t].iloc[i] for t in a["trigger"]) else [])
        rows.append(dict(start=str(cal[i].date()),
                         release=str(cal[a["release_i"]].date()) if a["release_i"] is not None else None,
                         reason=a["reason"], days=(a["release_i"] if a["release_i"] is not None else last) - i + 1,
                         trigger=a["trigger"], themes=list(a["joins"]), primary=prim, n_joins=len(a["events"]),
                         warnings=sorted(warn, key=WNAMES.index), per=per,
                         useful=any(x["maxdd10"] is not None and x["maxdd10"] <= -0.05 for x in trig),
                         complete10=all(x["complete10"] for x in trig),
                         **{k: per[prim][k] for k in ("fwd5", "fwd10", "fwd20", "maxdd10")}))
    # recall: the theme's own banner test fires on a day in [peak, half]; on that day an alert containing the
    # theme is necessarily up (it opens, the theme joins, or the theme is already in it). Lifecycle-independent.
    caught, missed = [], []
    for t in themes:
        c = conf[t].values
        for e in episodes[t]:
            rec = dict(theme=t, peak=str(cal[e["peak_i"]].date()), half=str(cal[e["half_i"]].date()),
                       trough=str(cal[e["trough_i"]].date()), depth=round(e["depth"] * 100, 1))
            hit = np.where(c[e["peak_i"]:e["half_i"] + 1])[0]
            if len(hit):
                k = e["peak_i"] + int(hit[0])
                caught.append(dict(rec, flagged=str(cal[k].date()), lead_days=e["half_i"] - k,
                                   dd_at_flag=round(float(levels[t].iloc[k] / levels[t].iloc[e["peak_i"]] - 1) * 100, 1)))
            else:
                missed.append(rec)
    # signal-level precision: first day of each run of banner-test days per theme
    sig = []
    i0 = cal.get_loc(cal[cal >= EVAL_START][0])
    for t in themes:
        c = conf[t].values
        starts = [i for i in range(i0, len(c)) if c[i] and not c[i - 1]]
        for i in starts:
            s = fwd_stats(levels[t], i)
            if s["complete10"]:
                sig.append(s["maxdd10"] <= -0.05)
    return rows, caught, missed, sig


def summarize(rows, caught, missed, sig, years, n_eval):
    done = [r for r in rows if r["complete10"]]
    f10 = [r["fwd10"] for r in rows if r["fwd10"] is not None]
    tot = len(caught) + len(missed)
    return dict(n_alerts=len(rows), per_year=round(len(rows) / years, 2),
                open_share=round(sum(r["days"] for r in rows) / n_eval, 3),
                longest_days=max((r["days"] for r in rows), default=0),
                useful_share=round(float(np.mean([r["useful"] for r in done])), 3) if done else None,
                med_fwd10=round(float(np.median(f10)) * 100, 2) if f10 else None,
                signals_per_year=round(len(sig) / years, 1),
                signal_useful=round(float(np.mean(sig)), 3) if sig else None,
                caught=len(caught), episodes=tot, recall=round(len(caught) / tot, 3) if tot else None)


def acceptance(conf, alerts, cal):
    """fires_1008: a semis theme passes the banner test on the 10/08 close.
    early_test: semis banner-test days on 10/01..10/07 (R-D11: not on 10/02).
    in_alert_before: semis themes already inside an open alert on 10/01..10/07 under this lifecycle."""
    i8 = cal.get_loc(ACC_DAY)
    semis = [t for t in conf.columns if t in SEMI]
    early_days = cal[(cal >= "2026-10-01") & (cal < ACC_DAY)]
    early_test = {str(d.date()): [t for t in semis if conf.loc[d, t]] for d in early_days}
    early_test = {d: v for d, v in early_test.items() if v}
    before = {}
    for d in early_days:
        k = cal.get_loc(d)
        on = sorted({t for a in alerts if a["start_i"] <= k and (a["release_i"] is None or a["release_i"] >= k)
                     for t, ji in a["events"] if t in SEMI and ji <= k})
        if on:
            before[str(d.date())] = on
    alert_1008 = [a for a in alerts if a["start_i"] <= i8 and (a["release_i"] is None or a["release_i"] >= i8)]
    return dict(fires_1008=any(conf[t].iloc[i8] for t in semis), semis_1008=[t for t in semis if conf[t].iloc[i8]],
                early_test=early_test, test_on_1002=bool(set(early_test) & {"2026-10-01", "2026-10-02"}),
                in_alert_before=before,
                alert_open_1008_since=str(cal[alert_1008[0]["start_i"]].date()) if alert_1008 else None)


def run_setting(ctx, X, Y, K, rules=("A", "B"), Wm=None, W6=None, drop=None):
    Wm = ctx["Wm"] if Wm is None else Wm
    W6 = ctx["W6"] if W6 is None else W6
    conf, _ = confirmations(ctx["shapes"], Wm, W6, X, Y, K, ctx["themes"], drop)
    out = {}
    for rule in rules:
        alerts = run_alerts(conf, ctx["shapes"], ctx["cal"], rule)
        rows, caught, missed, sig = evaluate(alerts, conf, ctx["levels"], ctx["episodes"], ctx["cal"],
                                             ctx["themes"], Wm, W6)
        summ = summarize(rows, caught, missed, sig, ctx["years"], ctx["n_eval"])
        deep_c = sum(c["depth"] <= -25 for c in caught)
        deep_t = deep_c + sum(m["depth"] <= -25 for m in missed)
        summ["recall_deep25"] = f"{deep_c}/{deep_t}"
        semis_conf = conf[[t for t in conf.columns if t in SEMI]].any(axis=1).values
        flags = "".join("Y" if semis_conf[e["peak_i"]:e["half_i"] + 1].any() else "." for e in ctx["sox_episodes"])
        summ["recall_sox"] = f"{flags.count('Y')}/{len(flags)}"
        summ["sox_flags"] = flags
        out[rule] = dict(summary=summ,
                         acc=acceptance(conf, alerts, ctx["cal"]), rows=rows, caught=caught, missed=missed)
    return out


def base_rate(levels, themes, cal):
    hits = []
    i0 = cal.get_loc(cal[cal >= EVAL_START][0])
    for t in themes:
        v = levels[t].values
        for i in range(i0, len(v) - 10):
            w = v[i + 1:i + 11]
            if not (np.isnan(v[i]) or np.isnan(w).any()):
                hits.append(w.min() / v[i] - 1 <= -0.05)
    return float(np.mean(hits))


def build_context():
    wl = pd.read_csv(C / "watchlist.csv")
    shares = pd.read_csv(C / "shares.csv").drop_duplicates("ticker").set_index("ticker")["shares"]
    px, mkt, cal = load_prices()
    levels, counts = theme_indices(px, wl, shares)
    levels = levels.loc[:, levels.notna().any()]
    themes = [t for t in levels.columns if t not in EXCLUDED_THEMES]
    shapes = prep_shapes(levels, mkt["^SOX"])
    n_eval = int((cal >= EVAL_START).sum())
    years = (cal[-1] - EVAL_START).days / 365.25
    episodes = {t: [e for e in find_episodes(levels[t]) if cal[e["peak_i"]] >= EVAL_START] for t in themes}
    sox_episodes = [e for e in find_episodes(mkt["^SOX"]) if cal[e["peak_i"]] >= EVAL_START]
    Wm, raw = market_warnings(cal, mkt, BASE)
    W6 = w6_theme(px, wl, shares, levels, BASE)
    return dict(wl=wl, shares=shares, px=px, mkt=mkt, cal=cal, levels=levels, counts=counts, themes=themes,
                shapes=shapes, n_eval=n_eval, years=years, episodes=episodes, sox_episodes=sox_episodes, Wm=Wm, W6=W6, raw=raw)


def choose(grid_rows, rule, max_open=0.5):
    """Recall first (R-D12), but a banner that is up on most days carries no information: among accepted
    settings under `rule` whose banner is up on <= max_open of trading days, take the highest recall;
    ties (within 0.5 point) -> fewest alerts/year."""
    ok = [r for r in grid_rows if r["accepted"] and r["rule"] == rule and r["open_share"] <= max_open]
    best = max(r["recall"] for r in ok)
    near = [r for r in ok if r["recall"] >= best - 0.005]
    return min(near, key=lambda r: (r["per_year"], -r["recall"]))


def main():
    ctx = build_context()
    grid_rows, runs = [], {}
    for X, Y, K in GRID:
        res = run_setting(ctx, X, Y, K)
        runs[(X, Y, K)] = res
        for rule, r in res.items():
            acc = r["acc"]
            grid_rows.append(dict(rule=rule, X=X, Y=Y, K=K, **r["summary"], fires_1008=acc["fires_1008"],
                                  semis_1008=acc["semis_1008"], test_on_1002=acc["test_on_1002"],
                                  early_test=acc["early_test"], in_alert_before=sorted(acc["in_alert_before"]),
                                  alert_open_1008_since=acc["alert_open_1008_since"],
                                  accepted=acc["fires_1008"] and not acc["test_on_1002"]))
    rule = "B"
    rec = choose(grid_rows, rule)
    X, Y, K = rec["X"], rec["Y"], rec["K"]
    best = runs[(X, Y, K)]

    sens = []  # +-1 step on each warning threshold, at the chosen X/Y/K
    for k, step in STEPS.items():
        for sgn in (-1, 1):
            p = dict(BASE, **{k: BASE[k] + sgn * step})
            Wm, _ = market_warnings(ctx["cal"], ctx["mkt"], p)
            W6 = w6_theme(ctx["px"], ctx["wl"], ctx["shares"], ctx["levels"], p) if k == "w6_share" else ctx["W6"]
            r = run_setting(ctx, X, Y, K, rules=(rule,), Wm=Wm, W6=W6)[rule]
            sens.append(dict(param=k, value=round(p[k], 4), **r["summary"], fires_1008=r["acc"]["fires_1008"],
                             test_on_1002=r["acc"]["test_on_1002"]))
    abl = []  # leave-one-out: remove one warning from the count, at the chosen X/Y/K and at K+1
    for kk in sorted({K, min(K + 1, 7)}):
        for w in [None] + WNAMES:
            r = run_setting(ctx, X, Y, kk, rules=(rule,), drop=w)[rule]
            abl.append(dict(K=kk, dropped=w or "-", **r["summary"], fires_1008=r["acc"]["fires_1008"]))
    rows = best[rule]["rows"]
    split = []  # alert-level: useful share when each warning was on vs off at the alert start
    for w in WNAMES:
        on = [r["useful"] for r in rows if r["complete10"] and w in r["warnings"]]
        off = [r["useful"] for r in rows if r["complete10"] and w not in r["warnings"]]
        split.append(dict(warning=w, n_on=len(on), useful_on=round(float(np.mean(on)), 3) if on else None,
                          n_off=len(off), useful_off=round(float(np.mean(off)), 3) if off else None))
    tm = ctx["cal"] >= EVAL_START
    warn_share = {w: round(float(ctx["Wm"][w][tm].mean()), 3) for w in ctx["Wm"].columns}
    warn_share["W6(any theme)"] = round(float(ctx["W6"][ctx["themes"]].any(axis=1)[tm].mean()), 3)
    hy_real = ctx["raw"]["hy"].notna()
    br = base_rate(ctx["levels"], ctx["themes"], ctx["cal"])
    i8 = ctx["cal"].get_loc(ACC_DAY)
    snap = dict(warnings_on={w: bool(ctx["Wm"][w].iloc[i8]) for w in ctx["Wm"].columns},
                W6_on=[t for t in ctx["themes"] if ctx["W6"][t].iloc[i8]],
                sox_dd20=round(float(ctx["shapes"]["^SOX"]["dd20"].iloc[i8]), 4),
                sox_down=int(ctx["shapes"]["^SOX"]["down"].iloc[i8]),
                semis_dd20={t: round(float(ctx["shapes"][t]["dd20"].iloc[i8]), 4) for t in ctx["themes"] if t in SEMI},
                semis_down={t: int(ctx["shapes"][t]["down"].iloc[i8]) for t in ctx["themes"] if t in SEMI},
                hy_known=float(ctx["raw"]["hy"].iloc[i8]), hy_10d=round(float(ctx["raw"]["hy"].diff(10).iloc[i8]), 3),
                dgs10_known=float(ctx["raw"]["dgs"].iloc[i8]),
                brent_20d=round(float(ctx["raw"]["brent"].iloc[i8] / ctx["raw"]["brent"].iloc[i8 - 20] - 1), 3),
                core_cpi_mm_known=round(float(ctx["raw"]["cpi"].iloc[i8]), 5),
                core_pce_mm_known=round(float(ctx["raw"]["pce"].iloc[i8]), 5))
    # why episodes were missed at the chosen setting: price test failed, or warnings short of K
    c0, _ = confirmations(ctx["shapes"], ctx["Wm"], ctx["W6"], X, Y, 0, ctx["themes"])
    cK, _ = confirmations(ctx["shapes"], ctx["Wm"], ctx["W6"], X, Y, K, ctx["themes"])
    mc = ctx["Wm"].sum(axis=1).values
    miss_reason = dict(price=0, warn=0, two=0)
    for t in ctx["themes"]:
        for e in ctx["episodes"][t]:
            sl = slice(e["peak_i"], e["half_i"] + 1)
            if cK[t].values[sl].any():
                continue
            on = c0[t].values[sl]
            if not on.any():
                miss_reason["price"] += 1
                continue
            miss_reason["warn"] += 1
            miss_reason["two"] += int((mc[sl] + ctx["W6"][t].values[sl])[on].max() == K - 1)
    member_counts = {t: int(ctx["counts"][t].iloc[-1]) for t in ctx["levels"].columns}
    first_index_day = {t: str(ctx["levels"][t].first_valid_index().date()) for t in ctx["levels"].columns}
    results = dict(
        eval_window=[str(EVAL_START.date()), str(ctx["cal"][-1].date())], years=round(ctx["years"], 2),
        themes=ctx["themes"], themes_without_index=sorted(set(ctx["wl"].theme) - set(ctx["levels"].columns)),
        excluded_from_trigger=sorted(EXCLUDED_THEMES), member_counts_last_day=member_counts,
        first_index_day=first_index_day,
        base_thresholds=BASE, release=RELEASE, hy_proxy=ctx["raw"]["proxy"],
        hy_first_obs=str(fred("BAMLH0A0HYM2").index.min().date()),
        w1_days_real_hy=int((hy_real & tm).sum()), w1_days_proxy=int((~hy_real & tm).sum()),
        warning_on_share=warn_share, base_rate_further5_10d=round(br, 3),
        episodes_total=sum(len(v) for v in ctx["episodes"].values()),
        episodes_by_theme={t: len(v) for t, v in ctx["episodes"].items()},
        sox_episodes=[dict(peak=str(ctx["cal"][e["peak_i"]].date()), half=str(ctx["cal"][e["half_i"]].date()),
                           trough=str(ctx["cal"][e["trough_i"]].date()), depth=round(e["depth"] * 100, 1))
                      for e in ctx["sox_episodes"]],
        grid=grid_rows, recommended_rule=rule, recommended=rec,
        recommended_rule_A=next(g for g in grid_rows if g["rule"] == "A" and (g["X"], g["Y"], g["K"]) == (X, Y, K)),
        recommended_alerts_by_year=pd.Series([r["start"][:4] for r in rows]).value_counts().sort_index().to_dict(),
        recommended_alerts=rows, recommended_alerts_rule_A=best["A"]["rows"],
        missed_reason=miss_reason, recommended_missed=best[rule]["missed"], recommended_caught=best[rule]["caught"],
        sensitivity=sens, ablation=abl, warning_split=split, acceptance_1008_snapshot=snap,
        acceptance_detail=best[rule]["acc"], acceptance_detail_rule_A=best["A"]["acc"])
    (HERE / "results.json").write_text(json.dumps(results, indent=1, default=str), encoding="utf-8")
    with open(OUT / "run.pkl", "wb") as f:
        pickle.dump(dict(results=results, levels=ctx["levels"], Wm=ctx["Wm"], W6=ctx["W6"], cal=ctx["cal"]), f)
    pd.set_option("display.width", 300)
    df = pd.DataFrame(grid_rows).drop(columns=["semis_1008", "early_test", "in_alert_before"])
    print(df.to_string())
    print("recommended", rule, {k: rec[k] for k in ("X", "Y", "K", "per_year", "useful_share", "caught", "episodes")})
    print("base rate", round(br, 3), "episodes", results["episodes_total"], "proxy", ctx["raw"]["proxy"])
    print(pd.DataFrame(sens).to_string())
    print(pd.DataFrame(abl).to_string())
    print(pd.DataFrame(split).to_string())
    print(json.dumps(snap, indent=1), json.dumps(best[rule]["acc"], indent=1), warn_share)


if __name__ == "__main__":
    main()
