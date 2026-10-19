"""Round 3: cut banner-up time. Reuses backtest.py (unchanged). Writes bt2/results3.json + bt2/out/run3.pkl.
Lifecycle variants on rule B: open gate (any / >=N themes same day / >=N distinct themes in 3 days / cap share S),
stay gate (close when < N themes left and ^SOX not confirming), per-theme quiet exit Q, and W6 dropped or kept.
"""
import itertools
import json
import pickle

import numpy as np
import pandas as pd

import backtest as bt

GRID = list(itertools.product([3, 4, 5], [1, 2], [2, 3]))
OPENS = ["any", "N2d1", "N3d1", "N2d3", "N3d3", "cap10", "cap20"]
QS = [5, 10, 15]
EVENTS = {  # window in which a banner-up day counts as "caught"; half = ^SOX half-drawdown day
    "2018Q4": ("2018-10-01", "2018-12-24", "2018-10-10"),
    "2020-02 COVID": ("2020-02-19", "2020-03-23", "2020-03-09"),
    "2022 bear": ("2022-01-03", "2022-10-14", "2022-01-20"),
    "2024-07": ("2024-07-10", "2024-08-07", "2024-07-24"),
    "2025-04 tariffs": ("2025-02-19", "2025-04-08", "2025-03-06"),
    "2026-06": ("2026-06-22", "2026-07-29", "2026-07-07"),
}


def sox_confirm(ctx, X, Y, K, drop):
    """^SOX price test (as round 2) with the warning count of any semis theme (market + that theme's W6)."""
    q = ctx["shapes"]["^SOX"]
    price = (q["dd20"] <= -X / 100 + 1e-12) & (q["down"] >= Y)
    mcount = ctx["Wm"][[c for c in ctx["Wm"].columns if c != drop]].sum(axis=1)
    semis = [t for t in ctx["themes"] if t in bt.SEMI]
    w6 = ctx["W6"][semis].any(axis=1).astype(int) if drop != "W6" else 0
    return (price & ((mcount + w6) >= K)).fillna(False).values


def theme_caps(ctx):
    px, sh, wl = ctx["px"], ctx["shares"], ctx["wl"]
    caps = px * sh.reindex(px.columns)
    total = caps.sum(axis=1, min_count=1)
    tc = {th: caps[[t for t in m if t in caps.columns]].sum(axis=1) for th, m in wl.groupby("theme").ticker}
    return pd.DataFrame(tc).div(total, axis=0).reindex(columns=ctx["themes"]).fillna(0.0)


def run_alerts3(conf, sox, capshare, shapes, cal, open_rule, stay, Q):
    alerts, cur = [], None
    Cv, cols = conf.values, list(conf.columns)
    dd = {t: shapes[t]["dd20"].values for t in cols}
    low = {t: shapes[t]["newlow"].values for t in cols}
    cs = capshare.values
    kind = open_rule[:3]
    N = int(open_rule[1]) if open_rule[0] == "N" else None
    win = int(open_rule[3]) if open_rule[0] == "N" else 1
    S = int(open_rule[3:]) / 100 if kind == "cap" else None
    stayN = N if stay else None
    i0 = cal.get_loc(cal[cal >= bt.EVAL_START][0])
    for i in range(i0, len(cal)):
        firing = [cols[j] for j in np.where(Cv[i])[0]]
        if cur is None:
            if open_rule == "any":
                trig = firing
            elif N is not None:
                trig = [cols[j] for j in np.where(Cv[i - win + 1:i + 1].any(axis=0))[0]]
                if not (len(trig) >= N or sox[i]):
                    trig = []
            else:
                trig = firing if (firing and (cs[i][[cols.index(t) for t in firing]].sum() >= S - 1e-12 or sox[i])) else []
            if trig:
                cur = dict(start_i=i, trigger=trig, joins={t: i for t in trig}, events=[(t, i) for t in trig],
                           active={t: i for t in trig})
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
                cur["active"][t] = i
        for t in list(cur["active"]):
            if t not in firing and (dd[t][i] > -bt.RELEASE["recover"] or i - cur["active"][t] >= Q):
                del cur["active"][t]
        if (not cur["active"]) or (stayN and len(cur["active"]) < stayN and not sox[i]):
            cur.update(release_i=i, reason="breadth" if cur["active"] else "all themes out")
            alerts.append(cur)
            cur = None
    if cur is not None:
        cur.update(release_i=None, reason="open")
        alerts.append(cur)
    return alerts


def evaluate3(ctx, alerts, conf):
    cal, levels, last = ctx["cal"], ctx["levels"], len(ctx["cal"]) - 1
    up = np.zeros(len(cal), bool)
    for a in alerts:
        up[a["start_i"]:(a["release_i"] if a["release_i"] is not None else last) + 1] = True
    rows, theme_useful = [], []
    for a in alerts:
        i = a["start_i"]
        per = {t: dict(joined=str(cal[ji].date()), **bt.fwd_stats(levels[t], ji)) for t, ji in a["joins"].items()}
        for t, ji in a["events"]:
            s = bt.fwd_stats(levels[t], ji)
            if s["complete10"]:
                theme_useful.append(s["maxdd10"] <= -0.05)
        trig = [per[t] for t in a["trigger"]]
        prim = min(a["trigger"], key=lambda t: float(levels[t].iloc[i] / levels[t].iloc[i - 19:i + 1].max()))
        warn = [w for w in ctx["Wm"].columns if ctx["Wm"][w].iloc[i]] + \
               (["W6"] if any(ctx["W6"][t].iloc[i] for t in a["trigger"]) else [])
        rows.append(dict(start=str(cal[i].date()),
                         release=str(cal[a["release_i"]].date()) if a["release_i"] is not None else None,
                         reason=a["reason"], days=(a["release_i"] if a["release_i"] is not None else last) - i + 1,
                         trigger=a["trigger"], themes=list(a["joins"]), primary=prim,
                         warnings=sorted(warn, key=bt.WNAMES.index),
                         useful=any(x["maxdd10"] is not None and x["maxdd10"] <= -0.05 for x in trig),
                         complete10=all(x["complete10"] for x in trig),
                         **{k: per[prim][k] for k in ("fwd5", "fwd10", "fwd20", "maxdd10")}))
    # recall: theme's own banner test fires on a day in [peak, half] AND an alert is up that day (it then contains
    # the theme). Under round 2's ungated open this equals round 2's measure.
    caught = deep_c = deep_t = 0
    for t in ctx["themes"]:
        c = conf[t].values & up
        for e in ctx["episodes"][t]:
            hit = c[e["peak_i"]:e["half_i"] + 1].any()
            caught += hit
            if round(e["depth"] * 100, 1) <= -25:
                deep_t += 1
                deep_c += hit
    semis = conf[[t for t in conf.columns if t in bt.SEMI]].any(axis=1).values & up
    flags = "".join("Y" if semis[e["peak_i"]:e["half_i"] + 1].any() else "." for e in ctx["sox_episodes"])
    done = [r for r in rows if r["complete10"]]
    f10 = [r["fwd10"] for r in rows if r["fwd10"] is not None]
    tm = cal >= bt.EVAL_START
    ev = {}
    for name, (s, e, half) in EVENTS.items():
        m = (cal >= s) & (cal <= e)
        days = cal[m & up]
        ev[name] = (str(days[0].date()) + ("" if days[0] <= pd.Timestamp(half) else " (late)")) if len(days) else None
    tot = sum(len(v) for v in ctx["episodes"].values())
    summ = dict(banner_share=round(float(up[tm].mean()), 3), n_alerts=len(rows),
                per_year=round(len(rows) / ctx["years"], 2),
                useful_alert=round(float(np.mean([r["useful"] for r in done])), 3) if done else None,
                useful_theme=round(float(np.mean(theme_useful)), 3) if theme_useful else None,
                med_fwd10=round(float(np.median(f10)) * 100, 2) if f10 else None,
                caught=int(caught), episodes=tot, recall_deep25=f"{deep_c}/{deep_t}",
                recall_sox=f"{flags.count('Y')}/{len(flags)}", sox_flags=flags,
                longest_days=max((r["days"] for r in rows), default=0))
    return rows, summ, ev, up


def acceptance3(ctx, alerts, conf, up):
    cal = ctx["cal"]
    i8 = cal.get_loc(bt.ACC_DAY)
    semis = [t for t in conf.columns if t in bt.SEMI]
    a8 = next((a for a in alerts if a["start_i"] <= i8 and (a["release_i"] is None or a["release_i"] >= i8)), None)
    semis_in_1008 = sorted({t for t, ji in a8["events"] if t in bt.SEMI and ji <= i8}) if a8 else []
    early = {}
    for d in ["2026-10-01", "2026-10-02"]:
        k = cal.get_loc(pd.Timestamp(d))
        a = next((a for a in alerts if a["start_i"] <= k and (a["release_i"] is None or a["release_i"] >= k)), None)
        early[d] = dict(any_alert_up=bool(up[k]), semis_test=[t for t in semis if conf[t].iloc[k]],
                        semis_in_alert=sorted({t for t, ji in a["events"] if t in bt.SEMI and ji <= k}) if a else [],
                        alert_since=str(cal[a["start_i"]].date()) if a else None)
    fires = bool(a8) and any(conf[t].iloc[i8] for t in semis)
    bad = any(v["semis_test"] or v["semis_in_alert"] for v in early.values())
    return dict(fires_1008=fires, alert_1008_since=str(cal[a8["start_i"]].date()) if a8 else None,
                opens_on_1008=bool(a8) and a8["start_i"] == i8,
                trigger_1008=a8["trigger"] if a8 and a8["start_i"] == i8 else None,
                semis_conf_1008=[t for t in semis if conf[t].iloc[i8]], semis_in_alert_1008=semis_in_1008,
                early=early, semis_early=bad, any_alert_1001_02=any(v["any_alert_up"] for v in early.values()),
                accepted=fires and not bad)


def main():
    ctx = bt.build_context()
    capshare = theme_caps(ctx)
    rows_out, store = [], {}
    for (X, Y, K), drop in itertools.product(GRID, [None, "W6"]):
        conf, _ = bt.confirmations(ctx["shapes"], ctx["Wm"], ctx["W6"], X, Y, K, ctx["themes"], drop)
        sox = sox_confirm(ctx, X, Y, K, drop)
        for op in OPENS:
            for stay in ([False, True] if op[0] == "N" else [False]):
                for Q in QS:
                    alerts = run_alerts3(conf, sox, capshare, ctx["shapes"], ctx["cal"], op, stay, Q)
                    rows, summ, ev, up = evaluate3(ctx, alerts, conf)
                    acc = acceptance3(ctx, alerts, conf, up)
                    key = f"X{X}Y{Y}K{K} open={op} stay={'N' if stay else '-'} Q={Q} W6={'off' if drop else 'on'}"
                    rows_out.append(dict(key=key, X=X, Y=Y, K=K, open=op, stay=stay, Q=Q, w6=drop is None, **summ,
                                         events=ev, **{k: v for k, v in acc.items() if k != "early"},
                                         early=acc["early"]))
                    store[key] = rows
    df = pd.DataFrame(rows_out)
    # pick: accepted, recall >= 80/345, and no alert of any kind up on 10/01-10/02; then lowest banner share
    ok = df[df.accepted & (df.caught >= 80) & ~df.any_alert_1001_02]
    pick = ok.sort_values(["banner_share", "caught"], ascending=[True, False]).iloc[0] if len(ok) else None
    ok_loose = df[df.accepted & (df.caught >= 80)]  # semis-only reading of the 10/01-02 rule
    pick_loose = ok_loose.sort_values(["banner_share", "caught"], ascending=[True, False]).iloc[0]
    # trade-off frontier over accepted settings: min banner share per recall level
    acc_df = df[df.accepted].sort_values(["caught", "banner_share"], ascending=[False, True])
    front, best = [], 9
    for _, r in acc_df.iterrows():
        if r.banner_share < best:
            best = r.banner_share
            front.append(r.key)
    res = dict(grid=rows_out, pick=pick.key if pick is not None else None,
               pick_alerts=store[pick.key] if pick is not None else None, frontier=front[::-1],
               pick_semis_only_rule=pick_loose.key, pick_semis_only_rule_alerts=store[pick_loose.key])
    (bt.HERE / "results3.json").write_text(json.dumps(res, indent=1, default=str), encoding="utf-8")
    with open(bt.OUT / "run3.pkl", "wb") as f:
        pickle.dump(dict(df=df, store=store), f)
    pd.set_option("display.width", 300)
    pd.set_option("display.max_rows", 500)
    cols = ["key", "banner_share", "per_year", "useful_alert", "useful_theme", "med_fwd10", "caught",
            "recall_deep25", "recall_sox", "fires_1008", "semis_early", "any_alert_1001_02"]
    print(df[df.accepted].sort_values("banner_share")[cols].head(40).to_string())
    print("frontier"); print(df.set_index("key").loc[front[::-1], cols[1:]].to_string())
    print("PICK", None if pick is None else pick.to_dict())


if __name__ == "__main__":
    main()
