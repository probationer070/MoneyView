import numpy as np
import pandas as pd
import pytest

from apps.api.services.risk.rules import load_rules
from packages.core_finance.risk_signals.decks import (
    candidates,
    crash_deck,
    forward_returns,
    is_useful,
    primary_theme,
)

RULES = load_rules().rules
DAYS = pd.bdate_range("2026-01-05", periods=90)
DAY = DAYS[-1].date()


def flat_then(last_of_20, base=100.0, n=90):
    """Flat at `base` for n rows, except the last close, which is last_of_20."""
    v = np.full(n, base)
    v[-1] = last_of_20
    return v


def test_crash_threshold_and_order():
    closes = pd.DataFrame(
        {
            "AT": flat_then(90.0),      # exactly -10%: included
            "JUST": flat_then(90.1),    # -9.9%: excluded
            "DEEP": flat_then(60.0),
            "AB": flat_then(90.0),      # ties AT, sorts after it by ticker
        },
        index=DAYS,
    )
    cards = crash_deck(closes, DAY, RULES)
    assert [c.ticker for c in cards] == ["DEEP", "AB", "AT"]
    deep = cards[0]
    assert deep.drawdown_pct == (60.0 / 100.0 - 1) * 100
    assert deep.high_close == 100.0 and deep.close == 60.0
    assert deep.high_date == DAYS[-2].date()  # latest date on ties
    assert len(deep.closes_30d) == 30 and deep.closes_30d[-1] == 60.0


def test_crash_needs_full_window_and_nan_dropped_in_30d():
    v = flat_then(80.0)
    v[-10] = np.nan
    short = pd.Series(flat_then(80.0), index=DAYS)
    short.iloc[:75] = np.nan  # only 15 rows: not a full 20-day window
    closes = pd.DataFrame({"GAP": v, "NEW": short}, index=DAYS)
    assert crash_deck(closes, DAY, RULES) == []
    # a gap older than the 20-row window does not disqualify, and NaN is dropped from closes_30d
    v2 = flat_then(80.0)
    v2[-25] = np.nan
    cards = crash_deck(pd.DataFrame({"OLD": v2}, index=DAYS), DAY, RULES)
    assert len(cards) == 1 and len(cards[0].closes_30d) == 30
    assert not np.isnan(cards[0].closes_30d).any()


def _cand_frame():
    rng = np.random.default_rng(7)
    r = rng.normal(0.004, 0.01, 90)
    sox = pd.Series(100 * np.cumprod(1 + r), index=DAYS)
    noise = lambda: rng.normal(0, 0.002, 90)  # noqa: E731
    near = 100 * np.cumprod(1 + r + noise())          # follows SOX, ends near its high
    closes = pd.DataFrame({"NEAR": near}, index=DAYS)
    return closes, sox, r, rng


def test_candidate_universe_and_partner_exclusion():
    closes, sox, _, rng = _cand_frame()
    # CRASHED is 25% below its high (not in the universe) and independent of SOX.
    g = rng.normal(0.004, 0.01, 90)
    g_down = g.copy()
    g_down[-40:] -= 0.012  # steady slide, small next to the daily noise, so returns stay correlated with g
    crashed = 100 * np.cumprod(1 + g_down)
    assert crashed[-1] <= 0.75 * crashed[-63:].max()
    closes["CRASHED"] = crashed
    # FOLLOW tracks CRASHED's returns (not SOX) and ends near its high, so only the crashed partner qualifies it.
    follower = 100 * np.cumprod(1 + g + rng.normal(0, 0.001, 90))
    closes["FOLLOW"] = follower
    out = {c.ticker: c for c in candidates(closes, sox, DAY, RULES)}
    assert "CRASHED" not in out
    assert out["NEAR"].corr_with == "^SOX" and out["NEAR"].corr >= RULES.candidates.corr_min
    assert -10 <= out["NEAR"].pct_from_high63 <= 0
    # FOLLOW's own partners never include FOLLOW; its best partner here is the crashed name
    assert out["FOLLOW"].corr_with == "CRASHED"
    assert all(c.corr_with != c.ticker for c in out.values())


def test_candidate_never_pairs_with_itself():
    closes, sox, _, rng = _cand_frame()
    # NEAR is its own SOX twin only when it IS the crashed set; here the lone near name is the sole
    # ticker, and with SOX uncorrelated it must not qualify through itself.
    closes["NEAR"] = 100 + np.cumsum(rng.normal(0, 1, 90))
    closes.loc[closes.index[-1], "NEAR"] = closes["NEAR"].iloc[-63:].max()
    assert candidates(closes, pd.Series(rng.normal(0, 1, 90) + 100, index=DAYS), DAY, RULES) == []


def test_candidate_corr_threshold():
    closes, sox, r, rng = _cand_frame()
    low = 100 * np.cumprod(1 + rng.normal(0, 0.01, 90))   # independent of SOX
    low[-1] = low[-63:].max()
    closes["LOW"] = low
    out = [c.ticker for c in candidates(closes, sox, DAY, RULES)]
    assert out == ["NEAR"]
    # two SOX followers: the tighter one ranks first, whatever the ticker order
    tight = 100 * np.cumprod(1 + r + rng.normal(0, 0.0002, 90))
    closes["ZTIGHT"] = tight
    ranked = candidates(closes, sox, DAY, RULES)
    assert [c.ticker for c in ranked] == ["ZTIGHT", "NEAR"]
    assert ranked[0].corr > ranked[1].corr


def test_candidate_mid_drawdown_is_neither_universe_nor_partner():
    closes, sox, r, rng = _cand_frame()
    g = rng.normal(0.004, 0.01, 90)
    for name, slide in (("MID", -0.0045), ("PEER", 0.0)):
        gg = g.copy()
        gg[-40:] += slide if name == "MID" else 0.0
        closes[name] = 100 * np.cumprod(1 + gg + (rng.normal(0, 0.001, 90) if name == "PEER" else 0))
    sox_mid = r.copy()
    sox_mid[-40:] -= 0.0085
    closes["SOXMID"] = 100 * np.cumprod(1 + sox_mid + rng.normal(0, 0.0005, 90))
    assert -20 < (closes["SOXMID"].iloc[-1] / closes["SOXMID"].iloc[-63:].max() - 1) * 100 < -10
    mid = closes["MID"]
    assert -20 < (mid.iloc[-1] / mid.iloc[-63:].max() - 1) * 100 < -10   # between near and crashed
    out = [c.ticker for c in candidates(closes, sox, DAY, RULES)]
    assert "SOXMID" not in out                 # follows SOX but is too far below its high
    assert "MID" not in out                    # too far below its high for the universe
    assert "PEER" not in out                   # tracks MID, which is not crashed enough to be a partner


def test_candidate_not_its_own_partner_when_bands_overlap():
    closes, sox, _, rng = _cand_frame()
    closes = closes[[]].copy()
    walk = 100 + np.cumsum(rng.normal(0, 1, 90))
    walk[-1] = walk[-63:].max() * 0.95
    closes["SOLO"] = walk
    indep = pd.Series(100 + np.cumsum(rng.normal(0, 1, 90)), index=DAYS)
    loose = RULES.model_copy(update={"candidates": RULES.candidates.model_copy(update={"crashed_drop_pct": 1.0})})
    assert candidates(closes, indep, DAY, loose) == []


def test_candidate_needs_forty_pairs():
    closes, sox, _, _ = _cand_frame()
    sox_sparse = sox.copy()
    sox_sparse.iloc[-63:-20] = np.nan  # ~20 pairs left
    assert candidates(closes, sox_sparse, DAY, RULES) == []
    assert [c.ticker for c in candidates(closes, sox, DAY, RULES)] == ["NEAR"]


def test_forward_returns_none_beyond_data():
    idx = pd.bdate_range("2026-03-02", periods=8)
    lvl = pd.Series([100, 102, 99, 98, 101, 105, 90, 95], index=idx, dtype=float)
    res = forward_returns(lvl, idx[0].date())
    assert res["fwd5"] == pytest.approx((105 / 100 - 1) * 100)
    assert res["fwd10"] is None and res["fwd20"] is None
    # the last valid row is reachable (7 rows later), one more is not
    edge = forward_returns(lvl, idx[0].date(), horizons=(7, 8))
    assert edge["fwd7"] == pytest.approx((95 / 100 - 1) * 100) and edge["fwd8"] is None
    assert res["max_dd10"] == pytest.approx((90 / 100 - 1) * 100)
    assert forward_returns(lvl, idx[-1].date()) == {"fwd5": None, "fwd10": None, "fwd20": None, "max_dd10": None}
    # rows are calendar positions: a NaN before the target does not shift it...
    gap = lvl.copy()
    gap.iloc[1] = np.nan
    g = forward_returns(gap, idx[0].date())
    assert g["fwd5"] == pytest.approx(5.0) and g["max_dd10"] == pytest.approx(-10.0)
    # ...and a NaN at the target row gives None
    gap.iloc[5] = np.nan
    assert forward_returns(gap, idx[0].date())["fwd5"] is None
    assert forward_returns(gap, idx[0].date(), horizons=(7,))["fwd7"] == pytest.approx(-5.0)


def test_max_dd10_window_is_next_ten_rows_not_ten_valid_rows():
    idx = pd.bdate_range("2026-03-02", periods=14)
    v = np.full(14, 100.0)
    v[1] = np.nan
    v[11] = 90.0  # row 11 is outside the next-10-rows window
    lvl = pd.Series(v, index=idx)
    assert forward_returns(lvl, idx[0].date())["max_dd10"] == 0.0
    v[10] = 90.0
    assert forward_returns(pd.Series(v, index=idx), idx[0].date())["max_dd10"] == pytest.approx(-10.0)


def test_max_dd10_clamped_at_zero():
    idx = pd.bdate_range("2026-03-02", periods=12)
    rising = pd.Series(np.arange(100.0, 112.0), index=idx)
    assert forward_returns(rising, idx[0].date())["max_dd10"] == 0.0


def test_missing_or_nan_day_gives_none():
    idx = pd.bdate_range("2026-03-02", periods=12)
    lvl = pd.Series(np.full(12, 100.0), index=idx)
    lvl.iloc[2] = np.nan
    none = {"fwd5": None, "fwd10": None, "fwd20": None, "max_dd10": None}
    assert forward_returns(lvl, idx[2].date()) == none
    assert forward_returns(lvl, pd.Timestamp("2026-03-07").date()) == none  # Saturday: not in index
    levels = pd.DataFrame({"a": lvl, "b": 100.0}, index=idx)
    assert is_useful(["a"], levels, idx[2].date()) is None
    assert is_useful(["b"], levels, pd.Timestamp("2026-03-07").date()) is None


def test_primary_theme_deepest():
    dd = {"b": -12.0, "a": -12.0, "c": -3.0}
    assert primary_theme(["c", "b", "a"], dd) == "a"
    assert primary_theme(["c", "b"], dd) == "b"


def test_useful_needs_ten_days():
    idx = pd.bdate_range("2026-03-02", periods=12)
    base = np.full(12, 100.0)
    dropped = base.copy()
    dropped[3] = 95.0                     # exactly -5%
    levels = pd.DataFrame({"hit": dropped, "calm": base, "short": base}, index=idx)
    levels.loc[idx[8]:, "short"] = np.nan  # only 7 rows after start
    start = idx[0].date()
    assert is_useful(["hit"], levels, start) is True
    assert is_useful(["calm"], levels, start) is False
    assert is_useful(["short"], levels, start) is None
    assert is_useful(["short", "hit"], levels, start) is True   # already decided
    assert is_useful(["calm", "short"], levels, start) is None
    # calm theme but start leaves under 10 rows
    assert is_useful(["calm"], levels, idx[5].date()) is None
    assert is_useful(["calm"], levels, idx[2].date()) is None   # 9 rows after start
    assert is_useful(["calm"], levels, idx[1].date()) is False  # exactly 10 rows after start
    # a NaN inside the 10-row window leaves only 9 usable rows: undecided
    levels.loc[idx[4], "calm"] = np.nan
    assert is_useful(["calm"], levels, idx[1].date()) is None


# Output of the per-pair loop implementation (before vectorising) on tests/fixtures/risk as of 2026-10-08:
# (ticker, corr_with, corr, pct_from_high63), in rank order.
_LOOP_RESULT_1008 = [
    ('LRCX', '^SOX', 0.8961946858752343, -7.741228424548541),
    ('TSM', '^SOX', 0.8857008069576022, -5.724577656935937),
    ('ENTG', '^SOX', 0.8835832649847192, -2.833690258462429),
    ('FORM', '^SOX', 0.8518426652527669, -8.157519841229288),
    ('LITE', 'AAOI', 0.8386488349007777, -7.481916975603065),
    ('MU', '^SOX', 0.8367735395335473, -5.608759908878158),
    ('MRVL', '^SOX', 0.8336562404136563, -4.3029920161145485),
    ('ADI', '^SOX', 0.8330318912741709, -3.4763988922964173),
    ('ASML', '^SOX', 0.8199986693057929, -6.018201513899535),
    ('MTSI', '^SOX', 0.7996674812712877, -8.115898389618437),
    ('VST', 'NRG', 0.7904707371442423, -7.585405179768456),
    ('NVT', '^SOX', 0.7863041034359957, -7.863089587188233),
    ('SMTC', '^SOX', 0.7734920871824257, -4.9239308343532295),
    ('ETN', 'VRT', 0.7680519291602574, -7.707188092013729),
    ('WCC', '^SOX', 0.7531235250794653, -7.33161600942519),
    ('CIEN', '^SOX', 0.750444617015604, -4.698722472007855),
    ('TXN', '^SOX', 0.7496678673520235, -5.013603288019031),
    ('PWR', '^SOX', 0.7221678096955005, -5.103436770244441),
    ('FIX', '^SOX', 0.7168268515795675, -9.29151033244785),
    ('BE', 'CRWV', 0.706518349145969, -7.7625233449981295),
    ('MPWR', '^SOX', 0.703424258219776, -7.439064033854259),
    ('EME', 'CRWV', 0.6874271817224444, -9.773460166545945),
    ('TECK', 'NEXA', 0.6831255128055362, -9.812177503018171),
    ('TWIN', 'AAOI', 0.6817984151214324, -9.401110446180795),
    ('PSIX', '^SOX', 0.6726526064509398, -6.062368784354344),
    ('CLS', 'APLD', 0.6701434482662624, -8.16762627567944),
    ('SMCI', '^SOX', 0.6603358636409776, -4.828656509249707),
    ('JPM', 'GS', 0.6602178178901508, -8.791980996430947),
    ('CEG', 'NRG', 0.6548921147575228, -5.1031913727495715),
    ('ANET', '^SOX', 0.6447330369581484, -2.2517724918317272),
    ('GEV', 'WULF', 0.6391302138232791, -7.397289993499334),
    ('HUBB', 'VRT', 0.6284052717696235, -8.226556275519448),
    ('DELL', '^SOX', 0.6058523217968721, -2.3538470507178944),
]


def test_candidates_match_loop_result_on_fixture():
    """Pins the vectorised deck to the per-pair loop's output on real data. Catches a misaligned
    correlation matrix (partner columns shifted or reversed). Self-pairs, the 40-pair rule and the
    tie-break are pinned by the synthetic tests above; this fixture has no case of them."""
    from datetime import date
    from pathlib import Path

    px = pd.read_csv(Path(__file__).resolve().parents[1] / "fixtures" / "risk" / "closes.csv",
                     index_col="date", parse_dates=True)
    sox = px.pop("^SOX")
    px.pop("RSP")
    got = candidates(px, sox, date(2026, 10, 8), RULES)
    assert [(c.ticker, c.corr_with) for c in got] == [(t, w) for t, w, _, _ in _LOOP_RESULT_1008]
    assert [c.corr for c in got] == pytest.approx([c for _, _, c, _ in _LOOP_RESULT_1008], abs=1e-12)
    assert [c.pct_from_high63 for c in got] == [p for _, _, _, p in _LOOP_RESULT_1008]


def test_candidate_tie_keeps_first_partner():
    """Catches a tie-break that keeps the last best partner: two crashed names with identical returns tie
    exactly, and the first in column order must win (the per-pair loop kept the first strict maximum)."""
    rng = np.random.default_rng(7)
    pattern = 100 * np.cumprod(1 + 0.01 * (-1.0) ** np.arange(90))
    crashed = pattern.copy()
    crashed[40:] *= 0.7  # inside the 63-row high window, before the 40-return corr window
    closes = pd.DataFrame({"NEAR": pattern, "P1": crashed, "P2": crashed.copy()}, index=DAYS)
    sox = pd.Series(100 + np.cumsum(rng.normal(0, 1, 90)), index=DAYS)
    short = RULES.model_copy(update={"candidates": RULES.candidates.model_copy(update={"corr_window": 40})})
    [card] = candidates(closes, sox, DAY, short)
    assert (card.ticker, card.corr_with) == ("NEAR", "P1")
    assert card.corr == pytest.approx(1.0)
