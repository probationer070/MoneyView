"""Surge-signal backtest (risk-signal part 2-b). Research only. Imports backtest.py unchanged.
Writes bt2/results_surge.json and bt2/report_surge.md.  Run: python bt2/surge.py
"""
import itertools
import json

import numpy as np
import pandas as pd

import backtest as bt

GRID = dict(n=[10, 20], k=[3, 5], Z=[1.5, 2.0], P=[10, 5], U=[3, 4], B=[60, 70], R=[55, 60], M=[3, 4, 5])
KEYS = list(GRID)
COMPS = ["mag", "accel", "pers", "breadth", "rsi"]
OFF_GAP, QUIET = 10, 10
CAP_GATE = 0.20


def label(s):
    return "n{n} k{k} Z{Z} P{P} U{U} B{B} R{R} M{M}".format(**s)


# ---------------------------------------------------------------- indicators
def rsi_wilder(lv, n=14):
    d = lv.diff()
    g = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    l = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + g / l)


def indicators(lv_full, valid, breadth_frac):
    """All component inputs for one series. Recursive indicators run on the series' own non-NaN days."""
    lv = lv_full.dropna()
    idx = lv_full.index
    r = lv.pct_change()
    out = {}
    # 1 magnitude: 5d return / (stdev of the 60 daily returns ending 5 days ago * sqrt 5)
    sd = r.rolling(60, min_periods=40).std().shift(5)
    out["z"] = ((lv / lv.shift(5) - 1) / (sd * np.sqrt(5))).reindex(idx)
    # 2 slope acceleration vs own trailing 250d distribution (past days only)
    out["ema"], out["acc_on"] = {}, {}
    for n in GRID["n"]:
        e = lv.ewm(span=n, adjust=False).mean()
        out["ema"][n] = e.reindex(idx).values
        slope = (e / e.shift(1) - 1) * 100
        for k in GRID["k"]:
            acc = slope - slope.shift(k)
            for P in GRID["P"]:
                thr = acc.shift(1).rolling(250, min_periods=120).quantile(1 - P / 100)
                out["acc_on"][(n, k, P)] = (acc >= thr).reindex(idx, fill_value=False).values
    # 3 persistence
    out["ups"] = (r > 0).astype(int).rolling(5).sum().reindex(idx).values
    # 4 breadth
    out["breadth"] = breadth_frac.reindex(idx).values
    # 5 RSI cross-up within last 5 days, now in [R, 80]
    rsi = rsi_wilder(lv)
    out["rsi"] = rsi.reindex(idx).values
    out["rsi_on"] = {}
    for R in GRID["R"]:
        cross = ((rsi.shift(1) < R) & (rsi >= R)).astype(int).rolling(5, min_periods=1).max() > 0
        out["rsi_on"][R] = (cross & (rsi >= R) & (rsi <= 80)).reindex(idx, fill_value=False).values
    hi20 = lv >= lv.rolling(20, min_periods=20).max() - 1e-12
    out["newhigh"] = hi20.reindex(idx, fill_value=False).values
    out["z"] = out["z"].values
    out["valid"] = valid.values & lv_full.notna().values
    out["v"] = lv_full.values
    return out


def comp_flags(ind, s):
    return dict(mag=np.nan_to_num(ind["z"], nan=-9) >= s["Z"] - 1e-12,
                accel=ind["acc_on"][(s["n"], s["k"], s["P"])],
                pers=np.nan_to_num(ind["ups"], nan=0) >= s["U"],
                breadth=np.nan_to_num(ind["breadth"], nan=0) >= s["B"] / 100 - 1e-12,
                rsi=ind["rsi_on"][s["R"]])


def signal(ind, s, drop=None, M=None):
    f = comp_flags(ind, s)
    cnt = sum(f[c].astype(int) for c in COMPS if c != drop)
    return (cnt >= (M or s["M"])) & ind["valid"]


def episodes(sig, ind, n, i0):
    """Start: signal on after >= 10 days off (and no event open). End: close < EMA_n, or 10 trading days
    without a new 20d high. Returns list of (start_i, end_i) inclusive."""
    v, ema, hi = ind["v"], ind["ema"][n], ind["newhigh"]
    ev, cur, last_on, last_hi = [], None, -10 ** 9, 0
    for i in range(len(sig)):
        if cur is not None and i > cur:
            if hi[i]:
                last_hi = i
            if (not np.isnan(v[i]) and v[i] < ema[i]) or i - last_hi >= QUIET:
                ev.append((cur, i))
                cur = None
        if sig[i]:
            if cur is None and i >= i0 and i - last_on > OFF_GAP:
                cur, last_hi = i, i
            last_on = i
    if cur is not None:
        ev.append((cur, len(sig) - 1))
    return ev


def fwd(v, i):
    n = len(v)
    o = {f"fwd{h}": (float(v[i + h] / v[i] - 1) if i + h < n and not np.isnan(v[i + h]) else None) for h in (5, 10, 20)}
    w = v[i + 1:i + 11]
    w = w[~np.isnan(w)]
    o["runup10"] = float(w.max() / v[i] - 1) if len(w) else None
    o["useful"] = (o["runup10"] >= 0.05) if len(w) == 10 else None
    o["false"] = bool(w.min() < v[i]) if len(w) == 10 else None
    return o


def find_rallies(v, gain=0.15, span=60):
    """Trough-to-peak >= gain within <= span days, de-duplicated (scan resumes after each peak)."""
    n, eps, t = len(v), [], 0
    while t < n:
        w = v[t + 1:t + 1 + span]
        if np.isnan(v[t]) or len(w) == 0 or np.all(np.isnan(w)) or np.nanmax(w) / v[t] - 1 < gain:
            t += 1
            continue
        p = t
        for _ in range(10):
            pk = p + 1 + int(np.nanargmax(v[p + 1:p + 1 + span]))
            p2 = p + int(np.nanargmin(v[p:pk + 1]))
            if p2 == p:
                break
            p = p2
        pk = p + 1 + int(np.nanargmax(v[p + 1:p + 1 + span]))
        g = v[pk] / v[p] - 1
        if g >= gain:
            half = next(k for k in range(p, pk + 1) if v[k] / v[p] - 1 >= g / 2)
            eps.append(dict(trough_i=p, peak_i=pk, half_i=half, gain=float(g)))
            t = pk + 1
        else:
            t += 1
    return eps


# ---------------------------------------------------------------- context
def build():
    wl = pd.read_csv(bt.C / "watchlist.csv")
    shares = pd.read_csv(bt.C / "shares.csv").drop_duplicates("ticker").set_index("ticker")["shares"]
    px, mkt, cal = bt.load_prices()
    levels, counts = bt.theme_indices(px, wl, shares)
    levels = levels.loc[:, levels.notna().any()]
    themes = [t for t in levels.columns if t not in bt.EXCLUDED_THEMES]
    r5 = px / px.shift(5) - 1
    mem = {th: [t for t in m if t in px.columns and pd.notna(shares.get(t))] for th, m in wl.groupby("theme").ticker}

    def bfrac(m):
        x = r5[m]
        return (x > 0).sum(axis=1) / x.notna().sum(axis=1).replace(0, np.nan)

    caps = px * shares.reindex(px.columns)
    total = caps.sum(axis=1, min_count=1)
    capshare = pd.DataFrame({th: caps[mem[th]].sum(axis=1) for th in themes}).div(total, axis=0).fillna(0)
    ind = {}
    for th in themes:
        ind[th] = indicators(levels[th], counts[th] >= 3, bfrac(mem[th]))
    semis_m = sorted({t for th in bt.SEMI for t in mem.get(th, [])})
    sox = mkt["^SOX"]
    ind["^SOX"] = indicators(sox, sox.notna(), bfrac(semis_m))
    i0 = cal.get_loc(cal[cal >= bt.EVAL_START][0])
    rallies = {t: [e for e in find_rallies(ind[t]["v"]) if e["trough_i"] >= i0] for t in themes + ["^SOX"]}
    # unconditional base rates (all valid theme-days in eval window with 10 complete days ahead)
    use, fal, f5, f10, f20 = [], [], [], [], []
    for th in themes:
        v = ind[th]["v"]
        for i in range(i0, len(v) - 10):
            if not ind[th]["valid"][i]:
                continue
            o = fwd(v, i)
            if o["useful"] is None:
                continue
            use.append(o["useful"]); fal.append(o["false"]); f5.append(o["fwd5"]); f10.append(o["fwd10"])
            if o["fwd20"] is not None:
                f20.append(o["fwd20"])
    base = dict(useful=float(np.mean(use)), false=float(np.mean(fal)), fwd5=float(np.mean(f5)),
                fwd10=float(np.mean(f10)), fwd20=float(np.mean(f20)), med_fwd10=float(np.median(f10)))
    return dict(px=px, cal=cal, themes=themes, ind=ind, i0=i0, rallies=rallies, capshare=capshare.values,
                base=base, n_eval=len(cal) - i0, years=(cal[-1] - cal[i0]).days / 365.25)


# ---------------------------------------------------------------- evaluation
GATES = ["any", "cap20", "cap30", "N3"]


def run(ctx, s, drop=None, M=None, keep_events=False):
    """Theme events + market banners. Gates: any = any theme in surge; capS = surging themes hold >= S% of
    watchlist cap or ^SOX surging; N3 = >= 3 themes in surge at once. An event is 'shown' under a gate when
    that gate's banner is up on its start day; useful/fwd/recall per gate use shown events only."""
    cal, i0, th = ctx["cal"], ctx["i0"], ctx["themes"]
    N = len(cal)
    active_cap, n_up, sox_up = np.zeros(N), np.zeros(N, int), np.zeros(N, bool)
    evs, eps = [], {}
    for j, name in enumerate(th + ["^SOX"]):
        ind = ctx["ind"][name]
        ep = episodes(signal(ind, s, drop, M), ind, s["n"], i0)
        eps[name] = ep
        for a, b in ep:
            if name == "^SOX":
                sox_up[a:b + 1] = True
            else:
                n_up[a:b + 1] += 1
                active_cap[a:b + 1] += ctx["capshare"][a:b + 1, j]
            evs.append(dict(theme=name, start_i=a, end_i=b, **fwd(ind["v"], a)))
    masks = dict(any=n_up > 0, cap20=(active_cap >= 0.20 - 1e-12) | sox_up,
                 cap30=(active_cap >= 0.30 - 1e-12) | sox_up, N3=n_up >= 3)
    W = slice(i0, N)

    def mean(key, rows):
        x = [e[key] for e in rows if e[key] is not None]
        return float(np.mean(x)) if x else None

    res = dict(setting=label(s), **s, drop=drop, M_used=M or s["M"])
    th_ev = [e for e in evs if e["theme"] != "^SOX"]
    nr = sum(len(ctx["rallies"][t]) for t in th)
    for g, mk in masks.items():
        shown = [e for e in th_ev if mk[e["start_i"]]]
        caught = 0
        for t in th:
            st = np.array([e["start_i"] for e in shown if e["theme"] == t], int)
            caught += sum(bool(((st >= r["trough_i"] - 5) & (st <= r["half_i"])).any()) for r in ctx["rallies"][t])
        m = mk[W]
        res.update({f"banner_{g}": float(m.mean()), f"bopen_{g}_yr": int((m[1:] & ~m[:-1]).sum() + m[0]) / ctx["years"],
                    f"shown_{g}": len(shown), f"shown_{g}_yr": len(shown) / ctx["years"],
                    f"useful_{g}": mean("useful", shown), f"false_{g}": mean("false", shown),
                    f"fwd5_{g}": mean("fwd5", shown), f"fwd10_{g}": mean("fwd10", shown), f"fwd20_{g}": mean("fwd20", shown),
                    f"recall_{g}": caught, f"recallsh_{g}": caught / nr})
    sox_ev = [e for e in evs if e["theme"] == "^SOX"]
    st = np.array([e["start_i"] for e in sox_ev], int)
    res.update(rallies=nr, events_yr=len(th_ev) / ctx["years"], mean_days=float(np.mean([e["end_i"] - e["start_i"] + 1 for e in th_ev])),
               sox_events=len(sox_ev), sox_useful=mean("useful", sox_ev), sox_fwd10=mean("fwd10", sox_ev),
               sox_recall=sum(bool(((st >= r["trough_i"] - 5) & (st <= r["half_i"])).any()) for r in ctx["rallies"]["^SOX"]),
               sox_rallies=len(ctx["rallies"]["^SOX"]))
    if keep_events:
        for e in evs:
            e["start"] = str(cal[e["start_i"]].date()); e["end"] = str(cal[e["end_i"]].date())
            e["days"] = e["end_i"] - e["start_i"] + 1
            e.update({f"shown_{g}": bool(mk[e["start_i"]]) for g, mk in masks.items()})
        res["event_list"] = evs
    return res


def top5_continuation(ctx):
    px = ctx["px"].iloc[ctx["i0"] - 1:]
    r = px.pct_change(fill_method=None)
    nxt = r.shift(-1)
    top, allm, hit_t, hit_a = [], [], [], []
    for d in range(1, len(r) - 1):
        row, nrow = r.iloc[d], nxt.iloc[d]
        ok = row.notna() & nrow.notna()
        if ok.sum() < 20:
            continue
        t5 = row[ok].nlargest(5).index
        top.append(nrow[t5].mean()); allm.append(nrow[ok].mean())
        hit_t.append((nrow[t5] > 0).mean()); hit_a.append((nrow[ok] > 0).mean())
    return dict(days=len(top), top5_next_mean=float(np.mean(top)), all_next_mean=float(np.mean(allm)),
                top5_next_median=float(np.median(top)), top5_up_share=float(np.mean(hit_t)),
                all_up_share=float(np.mean(hit_a)))


def pct(x, d=1):
    return "-" if x is None else f"{x * 100:+.{d}f}%"


def sh(x):
    return "-" if x is None else f"{x * 100:.0f}%"


def row_md(r, g):
    return (f"| {r['setting']} | {g} | {sh(r[f'banner_{g}'])} | {r[f'bopen_{g}_yr']:.1f} | "
            f"{r[f'shown_{g}_yr']:.1f} | {sh(r[f'useful_{g}'])} | {sh(r[f'false_{g}'])} | {pct(r[f'fwd5_{g}'])} | "
            f"{pct(r[f'fwd10_{g}'])} | {pct(r[f'fwd20_{g}'])} | {r[f'recall_{g}']}/{r['rallies']} |")


HDR = ["| setting | banner gate | banner up | openings/yr | shown events/yr | useful | false start | fwd5 | fwd10 | fwd20 | recall |",
       "|---|---|---|---|---|---|---|---|---|---|---|"]
PICK_GATE = "cap20"


def main():
    ctx = build()
    cal, base, years = ctx["cal"], ctx["base"], ctx["years"]
    print("built", ctx["n_eval"], "days", round(years, 2), "yrs; base", base)
    rows = [run(ctx, dict(zip(KEYS, v))) for v in itertools.product(*GRID.values())]
    print("grid", len(rows))
    # precision pick: brief gate (cap20), banner <= 20%, >= 1.5 shown events/yr; max useful, then recall
    g = PICK_GATE
    ok = [r for r in rows if r[f"banner_{g}"] <= 0.20 and r[f"shown_{g}_yr"] >= 1.5]
    ok.sort(key=lambda r: (r[f"useful_{g}"] or 0, r[f"recall_{g}"]), reverse=True)
    pick = ok[0]
    ps = {k: pick[k] for k in KEYS}
    P = run(ctx, ps, keep_events=True)
    ev = P["event_list"]
    # ablation at the pick
    Mb = min(ps["M"], 4)
    abl = [dict(drop=c, M=M, r=run(ctx, ps, drop=c, M=M)) for c in COMPS for M in (Mb, Mb - 1)]
    # each component alone (day level)
    alone = []
    for c in COMPS:
        u, cnt = [], 0
        for th in ctx["themes"]:
            ind = ctx["ind"][th]
            f = comp_flags(ind, ps)[c] & ind["valid"]
            for i in np.where(f)[0]:
                if ctx["i0"] <= i < len(cal) - 10:
                    o = fwd(ind["v"], i)
                    if o["useful"] is not None:
                        u.append(o["useful"])
            cnt += f[ctx["i0"]:].sum()
        alone.append(dict(comp=c, on_share=float(cnt / (ctx["n_eval"] * len(ctx["themes"]))), useful_day=float(np.mean(u))))
    # overheated RSI > 80
    oh = []
    for th in ctx["themes"]:
        ind = ctx["ind"][th]
        for i in np.where((np.nan_to_num(ind["rsi"]) > 80) & ind["valid"])[0]:
            if ctx["i0"] <= i < len(cal) - 20:
                o = fwd(ind["v"], i)
                if o["fwd10"] is not None and o["fwd20"] is not None:
                    oh.append((o["fwd10"], o["fwd20"], o["useful"]))
    oh = np.array(oh, float)
    overheated = dict(days=len(oh), share=len(oh) / (ctx["n_eval"] * len(ctx["themes"])),
                      fwd10=float(oh[:, 0].mean()), fwd20=float(oh[:, 1].mean()), useful=float(np.nanmean(oh[:, 2])))
    # 2026
    ev26 = sorted([e for e in ev if e["start"] >= "2026-01-01"], key=lambda e: (e["start"], e["theme"]))
    sox = ctx["ind"]["^SOX"]["v"]
    m = (cal >= "2026-08-01") & (cal <= "2026-10-16")
    pk_i = int(np.where(m)[0][np.nanargmax(sox[m])])
    fam = sorted(bt.SEMI) + ["^SOX"]
    oct_sig = {}
    for name in fam:
        ind = ctx["ind"][name]
        sig, f = signal(ind, ps), comp_flags(ind, ps)
        oct_sig[name] = [dict(date=str(cal[i].date()), on=bool(sig[i]), comps=[c for c in COMPS if f[c][i]],
                              rsi=None if np.isnan(ind["rsi"][i]) else round(float(ind["rsi"][i]), 1))
                         for i in np.where((cal >= "2026-10-01") & (cal <= "2026-10-16"))[0]]
    cont = top5_continuation(ctx)
    out = dict(base=base, years=years, n_eval=ctx["n_eval"], pick_gate=g, grid=rows,
               pick={k: v for k, v in P.items() if k != "event_list"},
               pick_events=[{k: v for k, v in e.items() if not k.endswith("_i")} for e in ev],
               ablation=[dict(drop=a["drop"], M=a["M"], **{k: v for k, v in a["r"].items() if k not in KEYS + ["drop", "setting"]}) for a in abl],
               alone=alone, overheated=overheated, sox_peak_2026=str(cal[pk_i].date()), oct2026=oct_sig,
               top5_continuation=cont,
               rallies={t: [dict(trough=str(cal[e["trough_i"]].date()), half=str(cal[e["half_i"]].date()),
                                 peak=str(cal[e["peak_i"]].date()), gain=e["gain"]) for e in r] for t, r in ctx["rallies"].items()})
    (bt.HERE / "results_surge.json").write_text(json.dumps(out, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o)))

    # ---------------- report
    th_ev = [e for e in ev if e["theme"] != "^SOX"]
    m4 = [r for r in rows if r["M"] <= 4]
    L = ["# Surge-signal backtest (risk-signal part 2-b)", "",
         f"Research only; nothing in the repo changed. Window {cal[ctx['i0']].date()}..{cal[-1].date()} "
         f"({years:.2f} yrs, {ctx['n_eval']} trading days), {len(ctx['themes'])} themes (defensives_other excluded; "
         f"theme-days with <3 members invalid), plus ^SOX. `surge.py` imports `backtest.py` unchanged. "
         f"Grid: the brief's 256 settings extended with M = 5 -> {len(rows)} settings, each scored under 4 banner gates.", "",
         "## Headline", "",
         f"- **No setting in the brief's grid (M <= 4) gets the banner to <= 20%** under any gate. 'Any theme' banner: "
         f"{sh(min(r['banner_any'] for r in m4))}-{sh(max(r['banner_any'] for r in m4))} of days; cap-20% gate: >= "
         f"{sh(min(r['banner_cap20'] for r in m4))}; >= 3 themes: >= {sh(min(r['banner_N3'] for r in m4))}. "
         "Only M = 5 (all five components on the same day) with a gate gets there.",
         f"- The edge is modest: the pick's shown events reach +5% within 10d {sh(P[f'useful_{g}'])} of the time vs a {sh(base['useful'])} base rate, "
         f"and recall of +15% rallies before their half-way point is low ({sh(P[f'recallsh_{g}'])}).",
         "", f"## Pick (precision first, brief gate `{g}`)", "",
         f"**{P['setting']}**, banner gate {g} (themes in surge hold >= 20% of watchlist cap, or ^SOX in surge): "
         f"EMA n={ps['n']}, accel lag k={ps['k']}, Z >= {ps['Z']}, accel top {ps['P']}%, >= {ps['U']}/5 up days, breadth >= {ps['B']}%, "
         f"RSI cross {ps['R']}, all {ps['M']} components on.", "",
         f"- Theme events (ungated lifecycle): {len(th_ev)} = {P['events_yr']:.1f}/yr total, {P['events_yr'] / len(ctx['themes']):.2f}/yr per theme, mean {P['mean_days']:.1f} trading days.",
         f"- Banner up **{sh(P[f'banner_{g}'])}** of trading days, {P[f'bopen_{g}_yr']:.1f} openings/yr; events shown under it {P[f'shown_{g}']} ({P[f'shown_{g}_yr']:.1f}/yr). "
         f"Ungated any-theme banner for the same setting: {sh(P['banner_any'])}.",
         f"- Shown events: useful (+5% further within 10d) **{sh(P[f'useful_{g}'])}** vs base **{sh(base['useful'])}**; "
         f"false starts (any close below start within 10d) {sh(P[f'false_{g}'])} vs base {sh(base['false'])}; "
         f"fwd5/10/20 {pct(P[f'fwd5_{g}'])} / {pct(P[f'fwd10_{g}'])} / {pct(P[f'fwd20_{g}'])} vs base {pct(base['fwd5'])} / {pct(base['fwd10'])} / {pct(base['fwd20'])}.",
         f"- All theme events (ungated): useful {sh(P['useful_any'])}, false {sh(P['false_any'])}, fwd10 {pct(P['fwd10_any'])}.",
         f"- Recall: **{P[f'recall_{g}']}/{P['rallies']}** ({sh(P[f'recallsh_{g}'])}) theme rallies caught by a shown event; ungated {P['recall_any']}/{P['rallies']}. "
         f"^SOX alone: {P['sox_events']} events, useful {sh(P['sox_useful'])}, recall {P['sox_recall']}/{P['sox_rallies']}.",
         "", "Rule: gate cap20, banner <= 20%, >= 1.5 shown events/yr; maximise shown-event useful share, then recall. "
         "Where B60 and B70 tie, B60 (the brief's default) is listed.", "",
         "## Method", "",
         "- Magnitude: 5d return / (stdev of the 60 daily returns ending 5 days earlier x sqrt 5); the window excludes the move itself.",
         "- Accel: slope = EMA_n(t)/EMA_n(t-1)-1 (%); accel = slope_t - slope_{t-k}; on when >= the (1-P) quantile of the previous 250 accel values (min 120).",
         "- Persistence: up days in last 5 >= U. Breadth: share of members with data whose 5d return > 0 >= B (^SOX: union of the 5 semis themes' members).",
         "- RSI: Wilder 14; crossed up through R within the last 5 days and now R..80. Overheated (> 80) reported separately.",
         "- Event: starts on a signal day after >= 10 signal-off days with no open event; ends on a close below EMA_n or 10 trading days without a new 20d high.",
         "- Banner gates: `any` = any theme in an event; `cap20`/`cap30` = themes in events hold >= 20/30% of watchlist cap (shares x close, 250 tickers) or ^SOX in an event; "
         "`N3` = >= 3 themes in events. An event is *shown* when its gate is up on its start day; useful/fwd/recall per gate use shown events only.",
         "- Useful = max close in the next 10 days >= +5% over the start close. Base = every valid theme-day in the window.",
         "- Recall: rally = trough-to-peak >= +15% within 60 days, de-duplicated; caught if a (shown) event starts in [trough-5d, first day half the gain is reached].",
         "", "## Best settings per gate (banner <= 20%, >= 1.5 shown/yr)", ""] + HDR
    for gg in GATES:
        c = sorted([r for r in rows if r[f"banner_{gg}"] <= 0.20 and r[f"shown_{gg}_yr"] >= 1.5],
                   key=lambda r: (r[f"useful_{gg}"] or 0, r[f"recall_{gg}"]), reverse=True)
        L += [row_md(r, gg) for r in c[:5]] or [f"| (none) | {gg} | | | | | | | | | |"]
    L += ["", "Closest the brief's grid (M <= 4) gets: lowest banner per gate:", ""] + HDR
    for gg in GATES:
        L.append(row_md(min(m4, key=lambda r: r[f"banner_{gg}"]), gg))
    L += ["", "## Parameter effects (grid means, gate cap20)", "",
          "| param | value | events/yr | banner cap20 | useful (shown) | recall (shown) |", "|---|---|---|---|---|---|"]
    for k in KEYS:
        for v in GRID[k]:
            gr = [r for r in rows if r[k] == v]
            us = [r["useful_cap20"] for r in gr if r["useful_cap20"] is not None]
            L.append(f"| {k} | {v} | {np.mean([r['events_yr'] for r in gr]):.1f} | {sh(np.mean([r['banner_cap20'] for r in gr]))} | "
                     f"{sh(np.mean(us))} | {sh(np.mean([r['recallsh_cap20'] for r in gr]))} |")
    L += ["", f"## Which components help (at the pick, gate {g})", "",
          "| variant | events/yr | banner up | shown/yr | useful | false | fwd10 | recall |", "|---|---|---|---|---|---|---|---|",
          f"| pick: all 5 on | {P['events_yr']:.1f} | {sh(P[f'banner_{g}'])} | {P[f'shown_{g}_yr']:.1f} | {sh(P[f'useful_{g}'])} | "
          f"{sh(P[f'false_{g}'])} | {pct(P[f'fwd10_{g}'])} | {P[f'recall_{g}']} |"]
    for a in abl:
        r = a["r"]
        L.append(f"| without {a['drop']}, {a['M']} of 4 | {r['events_yr']:.1f} | {sh(r[f'banner_{g}'])} | {r[f'shown_{g}_yr']:.1f} | {sh(r[f'useful_{g}'])} | "
                 f"{sh(r[f'false_{g}'])} | {pct(r[f'fwd10_{g}'])} | {r[f'recall_{g}']} |")
    a4 = {a["drop"]: a["r"] for a in abl if a["M"] == Mb}
    L += ["", f"Read-out: removing mag, accel or rsi lowers useful to ~{sh(min(a4[c][f'useful_{g}'] for c in ('mag', 'accel', 'rsi')))}-"
          f"{sh(max(a4[c][f'useful_{g}'] for c in ('mag', 'accel', 'rsi')))} (they carry the precision). Breadth is redundant at the pick "
          f"(without it: {a4['breadth'][f'shown_{g}']} vs {P[f'shown_{g}']} shown events). Dropping persistence keeps useful at "
          f"{sh(a4['pers'][f'useful_{g}'])} and raises recall {P[f'recall_{g}']} -> {a4['pers'][f'recall_{g}']} with banner {sh(a4['pers'][f'banner_{g}'])}: "
          "a simpler 4-component equivalent (mag + accel + breadth + rsi, all on)."]
    L += ["", f"Each component alone at the pick's parameters (share of theme-days on; useful from that day; base {sh(base['useful'])}):", "",
          "| component | on share | useful |", "|---|---|---|"] + [f"| {a['comp']} | {sh(a['on_share'])} | {sh(a['useful_day'])} |" for a in alone]
    L += ["", f"Overheated (RSI > 80): {sh(overheated['share'])} of theme-days; fwd10 {pct(overheated['fwd10'])}, fwd20 {pct(overheated['fwd20'])}, "
          f"useful {sh(overheated['useful'])} (base fwd10 {pct(base['fwd10'])}, fwd20 {pct(base['fwd20'])}, useful {sh(base['useful'])}).",
          "", "## Per theme (pick)", "", "| theme | events | /yr | shown (cap20) | useful (all) | rallies caught (all) |", "|---|---|---|---|---|---|"]
    for t in ctx["themes"] + ["^SOX"]:
        te = [e for e in ev if e["theme"] == t]
        u = [e["useful"] for e in te if e["useful"] is not None]
        st = np.array([e["start_i"] for e in te], int)
        rc = sum(bool(((st >= r["trough_i"] - 5) & (st <= r["half_i"])).any()) for r in ctx["rallies"][t])
        L.append(f"| {t} | {len(te)} | {len(te) / years:.1f} | {sum(e[f'shown_{g}'] for e in te)} | {sh(np.mean(u)) if u else '-'} | {rc}/{len(ctx['rallies'][t])} |")
    L += ["", "## 2026", "", f"^SOX Aug-Oct 2026 peak close: **{cal[pk_i].date()}**. Semis-family +15% rallies peaking in 2026:", ""]
    for t in fam:
        for r in ctx["rallies"][t]:
            if cal[r["peak_i"]] >= pd.Timestamp("2026-01-01"):
                L.append(f"- {t}: trough {cal[r['trough_i']].date()}, half {cal[r['half_i']].date()}, peak {cal[r['peak_i']].date()}, +{r['gain'] * 100:.0f}%")
    L += ["", "2026 events (all themes, pick):", "", f"| theme | start | end | shown ({g}) | fwd5 | fwd10 | fwd20 | run-up 10d |", "|---|---|---|---|---|---|---|---|"]
    for e in ev26:
        L.append(f"| {e['theme']} | {e['start']} | {e['end']} | {'yes' if e[f'shown_{g}'] else 'no'} | {pct(e['fwd5'])} | {pct(e['fwd10'])} | {pct(e['fwd20'])} | {pct(e['runup10'])} |")
    L += ["", "Semis family, 2026-10-01..10-16 (signal-on days; components on 10/08):", ""]
    for name, rr in oct_sig.items():
        on = [x["date"] for x in rr if x["on"]]
        d8 = next((x for x in rr if x["date"] == "2026-10-08"), None)
        L.append(f"- {name}: on {on if on else 'never'}; 10/08 {d8['comps'] if d8 else '-'} RSI {d8['rsi'] if d8 else '-'}")
    L += ["", f"## Every pick event from 2024 (`shown` = {g} banner up on the start day)", "",
          "| theme | start | end | days | shown | fwd5 | fwd10 | fwd20 | run-up 10d |", "|---|---|---|---|---|---|---|---|---|"]
    for e in sorted([e for e in ev if e["start"] >= "2024-01-01"], key=lambda e: (e["start"], e["theme"])):
        L.append(f"| {e['theme']} | {e['start']} | {e['end']} | {e['days']} | {'yes' if e[f'shown_{g}'] else 'no'} | {pct(e['fwd5'])} | "
                 f"{pct(e['fwd10'])} | {pct(e['fwd20'])} | {pct(e['runup10'])} |")
    L += ["", "## Informational: yesterday's top-5 watchlist gainers, next day", "",
          f"{cont['days']} days: top-5 next-day mean {pct(cont['top5_next_mean'], 3)} (median of daily means {pct(cont['top5_next_median'], 3)}) "
          f"vs all names {pct(cont['all_next_mean'], 3)}. Share up next day: top-5 {sh(cont['top5_up_share'])} vs all {sh(cont['all_up_share'])}."]
    (bt.HERE / "report_surge.md").write_text("\n".join(L), encoding="utf-8")
    print("pick", P["setting"], {k: P[k] for k in ("events_yr", f"banner_{g}", f"bopen_{g}_yr", f"shown_{g}_yr", f"useful_{g}", f"recall_{g}", "rallies", "banner_any")})
    print("2026", [(e["theme"], e["start"], e["end"], e[f"shown_{g}"]) for e in ev26 if e["theme"] in fam])
    print("peak", cal[pk_i].date(), "top5", cont)


if __name__ == "__main__":
    main()
