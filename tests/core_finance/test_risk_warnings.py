import numpy as np
import pandas as pd

from apps.api.services.risk.rules import load_rules
from packages.core_finance.risk_signals.warnings import market_warnings

RULES = load_rules().rules
CAL = pd.bdate_range("2026-01-01", "2026-12-31")
FLAT = pd.Series(100.0, index=CAL)


def _daily(value, start="2026-01-01", end="2026-12-31"):
    idx = pd.bdate_range(start, end)
    return pd.Series(float(value), index=idx)


def _run(fred, sox=FLAT, rsp=FLAT):
    return market_warnings(CAL, fred, sox, rsp, RULES)


def _at(frame_df, col, day):
    return frame_df.loc[pd.Timestamp(day), col]


def test_daily_lag_one_business_day():
    dgs = _daily(4.0, end="2026-10-09")
    dgs[pd.Timestamp("2026-10-12")] = 5.10  # Monday
    dgs = dgs.sort_index()
    wf = _run({"DGS10": dgs})
    assert _at(wf.state, "W2", "2026-10-12") == "off"
    assert _at(wf.state, "W2", "2026-10-13") == "on"
    assert _at(wf.observed_at, "W2", "2026-10-13") == pd.Timestamp("2026-10-12")
    assert _at(wf.value, "W2", "2026-10-13") == 5.10


def test_w4_no_lag_and_inclusive_60_days():
    ff = pd.Series(
        [4.0, 4.25], index=pd.to_datetime(["2026-03-01", "2026-09-16"]), dtype=float
    )
    wf = _run({"DFEDTARU": ff})
    assert _at(wf.state, "W4", "2026-09-15") == "off"
    assert _at(wf.state, "W4", "2026-09-16") == "on"
    assert _at(wf.state, "W4", "2026-11-13") == "on"  # Friday
    assert _at(wf.state, "W4", "2026-11-16") == "off"
    assert wf.value.loc["2026-11-13", "W4"] == 58
    # 2026-11-15 is a Sunday, the last inclusive day; test the boundary directly
    cal = pd.DatetimeIndex(["2026-11-15", "2026-11-16"])
    wf2 = market_warnings(cal, {"DFEDTARU": ff}, pd.Series(1.0, cal), pd.Series(1.0, cal), RULES)
    assert wf2.state["W4"].tolist() == ["on", "off"]


def test_cpi_known_from_15th():
    cpi = pd.Series(
        [100.0, 100.1, 100.1 * 1.0, 100.1 * 1.0065],
        index=pd.to_datetime(["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"]),
    )
    wf = _run({"CPILFESL": cpi})
    assert _at(wf.state, "W5", "2026-10-14") == "off"
    assert _at(wf.state, "W5", "2026-10-15") == "on"
    assert abs(_at(wf.value, "W5", "2026-10-15") - 0.65) < 1e-9
    assert _at(wf.observed_at, "W5", "2026-10-15") == pd.Timestamp("2026-09-01")


def test_pce_known_from_month_end():
    pce = pd.Series(
        [100.0, 100.1, 100.1 * 1.005],
        index=pd.to_datetime(["2026-06-01", "2026-07-01", "2026-08-01"]),
    )
    wf = _run({"PCEPILFE": pce})
    assert _at(wf.state, "W5", "2026-09-29") == "off"
    assert _at(wf.state, "W5", "2026-09-30") == "on"


def test_w5_unknown_only_when_neither_known_and_max_of_components():
    wf = _run({})
    assert (wf.state["W5"] == "unknown").all()
    cpi = pd.Series([100.0, 100.5], index=pd.to_datetime(["2026-07-01", "2026-08-01"]))
    pce = pd.Series([100.0, 100.1], index=pd.to_datetime(["2026-07-01", "2026-08-01"]))
    wf = _run({"CPILFESL": cpi, "PCEPILFE": pce})
    assert _at(wf.state, "W5", "2026-09-30") == "on"
    assert abs(_at(wf.value, "W5", "2026-09-30") - 0.5) < 1e-9


def test_w1_proxy_before_hy_from():
    cal = pd.bdate_range("2023-10-02", "2023-12-29")
    baa = pd.Series(1.0, index=cal)
    baa[pd.Timestamp("2023-10-30")] = 1.95
    baa = baa.sort_index()
    wf = market_warnings(cal, {"BAA10Y": baa}, pd.Series(1.0, cal), pd.Series(1.0, cal), RULES)
    assert wf.state.loc["2023-10-31", "W1"] == "on"
    assert bool(wf.w1_proxy["2023-10-31"]) is True
    assert wf.value.loc["2023-10-31", "W1"] == 1.95
    # on/after hy_from with no HY: unknown, not counted
    d = pd.Timestamp("2023-11-06")
    assert not bool(wf.w1_proxy[d])
    assert wf.state.loc[d, "W1"] == "unknown"
    assert wf.on_count[d] == 0
    assert wf.on_count["2023-10-31"] == 1


def test_w1_hy_after_switch_uses_hy_thresholds():
    hy = _daily(3.0)
    hy[pd.Timestamp("2026-05-05")] = 3.6
    hy = hy.sort_index()
    wf = _run({"BAMLH0A0HYM2": hy})
    assert _at(wf.state, "W1", "2026-05-06") == "on"
    assert not bool(wf.w1_proxy["2026-05-06"])
    assert _at(wf.state, "W1", "2026-05-04") == "off"


def _px(drop_from_peak):
    s = pd.Series(100.0, index=CAL)
    s.iloc[100:] = 100.0 * (1 - drop_from_peak)
    return s


def test_w7_breadth():
    rsp = pd.Series(100.0, index=CAL)
    # SOX 2% below peak while rsp rose 4%: ratio about 5.8% below its max
    sox = pd.Series(100.0, index=CAL)
    sox.iloc[100:] = 98.0
    rsp.iloc[100:] = 104.0
    wf = _run({}, sox, rsp)
    assert wf.state.iloc[120]["W7"] == "on"
    assert wf.observed_at.iloc[120]["W7"] == CAL[120]
    assert wf.value.iloc[120]["W7"] > 5.0
    sox.iloc[100:] = 93.0
    wf = _run({}, sox, rsp)
    assert wf.state.iloc[120]["W7"] == "off"
    assert wf.state.iloc[10]["W7"] == "unknown"


def test_missing_series_unknown():
    wf = _run({"DGS10": _daily(4.0)})
    assert (wf.state["W3"] == "unknown").all()
    assert (wf.state["W4"] == "unknown").all()
    assert wf.value["W3"].isna().all()


def test_w3_percent_change_and_w2_level_alone_with_short_history():
    brent = _daily(80.0, end="2026-03-31")
    brent[pd.Timestamp("2026-04-01")] = 100.0  # +25% vs 20 rows earlier
    brent = brent.sort_index()
    short = pd.Series([5.2], index=pd.to_datetime(["2026-02-02"]))
    wf = _run({"DCOILBRENTEU": brent, "DGS10": short})
    day = "2026-04-02"
    assert _at(wf.state, "W3", day) == "on"
    assert abs(_at(wf.value, "W3", day) - 25.0) < 1e-9
    assert _at(wf.state, "W2", "2026-02-04") == "on"
    wf = _run({"DGS10": pd.Series([4.0], index=pd.to_datetime(["2026-02-02"]))})
    assert _at(wf.state, "W2", "2026-02-04") == "unknown"


def test_w1_proxy_uses_proxy_rise_threshold():
    cal = pd.bdate_range("2023-10-02", "2023-12-29")
    baa = pd.Series(1.0, index=cal)
    baa[pd.Timestamp("2023-10-20"):] = 1.15  # +0.15 over 10 rows: above proxy 0.10, below HY 0.30
    wf = market_warnings(cal, {"BAA10Y": baa}, pd.Series(1.0, cal), pd.Series(1.0, cal), RULES)
    assert wf.state.loc["2023-10-24", "W1"] == "on"
    hy = pd.Series(2.0, index=cal)
    hy[pd.Timestamp("2023-11-10"):] = 2.15  # same +0.15 on HY after hy_from: off
    wf = market_warnings(cal, {"BAMLH0A0HYM2": hy}, pd.Series(1.0, cal), pd.Series(1.0, cal), RULES)
    assert wf.state.loc["2023-11-14", "W1"] == "off"
