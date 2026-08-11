"""Damodaran's two SpaceX cases as reference fixtures.

Every number below is read from his spreadsheets, not reconstructed:

    S4  SpaceX2026IPO.xlsx          valued 2026-04-01  (pre-prospectus)
    S5  SpaceX2026IPOUpdated.xlsx   valued 2026-06-01  (post-prospectus)

`guideline/sop/todo3-spreadsheet-values.md` transcribes both, cell by cell, and
is the authority for anything here. `todo3.md` remains the source for the
narratives -- the "why" behind each number -- but it is a reconstruction from
blog posts, and where the two disagree the spreadsheet wins. Three places they
disagree are called out in the narratives below: launch's post-prospectus
revenue target, the expansion segment's target, and AI's pre-prospectus margin.

Both cases are seeded because the pair is the point: enterprise value barely
moved across a 277-page prospectus, 1216.06 -> 1224.45, +0.69%.

Confidence tags: `confirmed` means the value is a cell in one of the two
workbooks. `derived` means it is computed from such cells. `assumed` is now rare
here -- the spreadsheets closed most of what todo3 tagged [V].

`roic_stable` is 0.15 in both workbooks (`Input sheet!B56`, an override on the
template's default of "terminal return = cost of capital"). It sits far below
either case's target-year marginal return on new capital -- 1.017 post, 0.901
pre -- and `run_case` reports that gap as `terminal_capital_intensity_change`
rather than rejecting it. Returns fading to a mature level is the framework's
terminal assumption; see the note above the constants in `segment_valuation.py`.
The value is still un-narrated at the case level, because the narrative rule
covers segment fields only -- `guideline/sop/todo.md`, "Known divergences",
item 3.

No `initial_growth`. The engine's anchored curve pins year-1 growth to an
observed rate, and the spreadsheets show the source does no such thing: S5's
year-1 growth is 58.6% for launch, 63.6% for connectivity and 326.6% for AI,
against 2025 actuals of 7.6%, 49.8% and 22.2%. todo3 R3's `[C]` claim that the
June revision SLOWED near-term growth is confirmed -- launch's year-1 growth
falls 160.7% -> 58.6% between the workbooks -- but the mechanism is the cut to
launch's 2036 revenue target, not an anchor on the observed rate. The anchored
curve stays in the engine as a generic option; it is not what Damodaran did.

The revenue path shape is still wrong, and is the largest remaining divergence.
The source interpolates by closing a fixed fraction of the remaining gap to a
waypoint one third of the way from base to target at year 5; this engine decays
a solved growth rate. Because terminal value is ~87% of enterprise value and
depends only on the target year, the post-prospectus case still lands within
0.4% of the source, but the explicit period does not match year by year.

Not wired into application startup: fixture data does not belong in a database
unless someone asked for it.
"""

from __future__ import annotations

from apps.api.services.valuation_case import create_case, list_cases

PRE_CASE_NAME = "spacex_2026_04_pre_prospectus"
POST_CASE_NAME = "spacex_2026_06_post_prospectus"

# Base-year revenue and operating margin, per case. `Input sheet!B8:B10` and
# `Valuation output!B8:B11`. The segment SPLIT is no longer an assumption: the
# workbooks carry one revenue row per segment.
_BASE_PRE = {
    "launch": (4.100, 0.08),
    "connectivity": (11.400, 0.10),
    "ai": (0.100, -0.05),
    "expansion": (0.0, 0.00),
}

_BASE_POST = {
    "launch": (4.086, 0.08),
    "connectivity": (11.387, 0.10),
    "ai": (3.201, -0.05),
    "expansion": (0.0, 0.00),
}

_BASE_REVENUE_CLAIM = {
    "launch": (
        "Input sheet!B8. FY2025 launch revenue. Both workbooks also carry the "
        "prior year (3.500 pre, 3.796 post)."
    ),
    "connectivity": (
        "Input sheet!B9. FY2025 Starlink revenue, prior year 8.000 pre / 7.599 "
        "post. Context, not contradiction: Starlink reported ~10.3m subscribers "
        "at ~$66/mo ARPU in Q1 2026, an $8.16bn annualized run-rate from a "
        "different period."
    ),
    "ai": (
        "Input sheet!B10. The 32x jump between the workbooks, 0.100 -> 3.201, "
        "is the prospectus disclosing xAI revenue that the April valuation had "
        "to guess at."
    ),
    "expansion": (
        "No base-year revenue row exists for this segment in either workbook. "
        "It is a real-option proxy that starts earning in year 6, not a "
        "business with revenue today."
    ),
}

_BASE_MARGIN_CLAIM = (
    "Valuation output!B8:B11, identical in both workbooks: 8% launch, 10% "
    "connectivity, -5% AI, 0% expansion. These are the starting point of the "
    "margin ramp and are typed constants in the source -- they do NOT reconcile "
    "with its own base-year EBIT (row 12 gives -0.317 pre and +4.020 post, the "
    "R&D-adjusted reported figures, against 1.463 and 1.306 implied by these "
    "margins). The inconsistency is the source's, carried rather than resolved. "
    "The base year is not discounted, so it does not enter enterprise value."
)


def _narrative(field, claim, confidence, three_p="probable", source="S5 spreadsheet"):
    return {
        "input_field": field,
        "claim": claim,
        "evidence_source": source,
        "confidence": confidence,
        "three_p": three_p,
    }


def _segment(name, base, *, margin_target, margin_claim, s2c_early, s2c_late,
             s2c_claim, tam=None, tam_claim=None, share=None, share_claim=None,
             share_confidence="confirmed", share_three_p="probable",
             revenue_target=None, revenue_claim=None, revenue_three_p="probable",
             margin_three_p="probable", ramp_start_year=1):
    # `confidence` and `three_p` are orthogonal. Confidence answers "is this the
    # number the source used" -- `confirmed` throughout, because every value is a
    # spreadsheet cell. three_p answers "how strong is the claim the number
    # makes", which the source's authorship does not settle: he assumed the
    # expansion segment's endpoints outright, and his base margins do not
    # reconcile with his own base-year EBIT.
    base_revenue, base_margin = base[name]
    src = "S4 spreadsheet" if base is _BASE_PRE else "S5 spreadsheet"
    narratives = [
        _narrative("base_revenue", _BASE_REVENUE_CLAIM[name], "confirmed", source=src),
        _narrative("base_margin", _BASE_MARGIN_CLAIM, "confirmed",
                   three_p="plausible", source=src),
        _narrative("margin_target", margin_claim, "confirmed",
                   three_p=margin_three_p, source=src),
        _narrative("sales_to_capital_early", s2c_claim, "confirmed", source=src),
        _narrative("sales_to_capital_late", s2c_claim, "confirmed", source=src),
    ]
    if tam is not None:
        narratives.append(_narrative("tam_target", tam_claim, "confirmed", source="todo3 section 7"))
        narratives.append(_narrative("market_share_target", share_claim,
                                     share_confidence, three_p=share_three_p, source=src))
    if revenue_target is not None:
        narratives.append(_narrative("revenue_target", revenue_claim, "confirmed",
                                     three_p=revenue_three_p, source=src))

    return {
        "name": name,
        "base_revenue": base_revenue,
        "base_margin": base_margin,
        "tam_target": tam,
        "market_share_target": share,
        "revenue_target": revenue_target,
        "margin_target": margin_target,
        "sales_to_capital_early": s2c_early,
        "sales_to_capital_late": s2c_late,
        "ramp_start_year": ramp_start_year,
        "initial_growth": None,
        "narratives": narratives,
    }


# TAM is the one endpoint input the spreadsheets do not carry: target revenues
# are typed as single constants, with no TAM x share arithmetic behind them.
# These two TAMs come from todo3 section 7, where the blog posts state them.
_LAUNCH_TAM = (
    "The launch market grows from $30bn to $100bn as government and private "
    "demand rises. The prospectus TAM is rejected as an over-reach. The "
    "spreadsheets carry only the resulting revenue, never the TAM itself."
)
_CONN_TAM = (
    "Satellite internet goes from 1% to 10% of a $1.5T internet market. As "
    "with launch, the spreadsheets carry only the resulting revenue."
)
_CONN_SHARE = (
    "75%: Starlink's satellite lead plus captive launch capacity is "
    "defensible. Reconciles exactly with the spreadsheets, which put "
    "connectivity's 2036 revenue at 120.0 in both workbooks -- 160 x 0.75."
)
_CONN_MARGIN = (
    "Input sheet!B31, 60% in both workbooks. Once satellites are in orbit "
    "incremental subscribers are nearly pure margin, and CAC eases as the "
    "business mix rises; gross margin went 37% to 48% across 2024-2025."
)
_EXPANSION_MARGIN = (
    "Input sheet!B33, 30% in both workbooks. Assumed mid-range for an "
    "unspecified business: the segment is a placeholder for optionality, not "
    "a forecast. The 30% is the source's own assumption, confirmed as being "
    "what he used, not endorsed as well-founded."
)
_EXPANSION_RAMP = (
    "Revenue is zero through year 5, then linear to the target across years "
    "6-10 (Valuation output row 6). Mars, space tourism and in-space business "
    "are excluded outright: no viable revenue path today."
)


def _pre_prospectus_payload() -> dict:
    return {
        "case_name": PRE_CASE_NAME,
        "ticker": None,
        "as_of_date": "2026-04-01",
        "base_year": 2026,
        "target_year": 2036,
        "riskfree_rate": 0.0420,
        "wacc_initial": 0.080246,
        "wacc_stable": 0.0800,
        "wacc_converge_from": 6,
        "marginal_tax_rate": 0.25,
        "nol_balance": 0.0,
        "roic_stable": 0.15,
        "terminal_growth": None,
        "cash": 0.0,
        "debt": 0.0,
        "ipo_proceeds": 0.0,
        "shares_basic": 2.416667,
        "shares_new": 0.0,
        "parent_case_id": None,
        "segments": [
            _segment(
                "launch", _BASE_PRE, tam=100.0, tam_claim=_LAUNCH_TAM, share=0.70,
                share_claim=(
                    "70%: SpaceX stays dominant but sheds share to security- and "
                    "nationalism-driven entrants. Reconciles exactly with Input "
                    "sheet!B26, which puts launch's 2036 revenue at 70.0 -- "
                    "100 x 0.70."
                ),
                margin_target=0.40,
                margin_claim=(
                    "Input sheet!B30. Reusability and existing infrastructure "
                    "produce a durable cost advantage."
                ),
                s2c_early=4.0, s2c_late=2.0,
                s2c_claim=(
                    "Input sheet!B36/C36: 4 for years 1-5, 2 for years 6-10. "
                    "Capital intensity RISES with scale in the April model. The "
                    "June model reverses this to 3 then 4. todo3 I2 records only "
                    "that the ratios were lowered, and misses the reversal."
                ),
            ),
            _segment(
                "connectivity", _BASE_PRE, tam=160.0, tam_claim=_CONN_TAM,
                share=0.75, share_claim=_CONN_SHARE,
                margin_target=0.60, margin_claim=_CONN_MARGIN,
                s2c_early=10.0, s2c_late=5.0,
                s2c_claim=(
                    "Input sheet!B37/C37: 10 for years 1-5, 5 for years 6-10. "
                    "The 10 is the highest ratio anywhere in either workbook, "
                    "and the June model cuts it to 3 after seeing 2025 capex."
                ),
            ),
            _segment(
                "ai", _BASE_PRE, revenue_target=80.0,
                revenue_claim=(
                    "Input sheet!B28. xAI against a $3-4T real enterprise AI "
                    "market, before the Cursor acquisition."
                ),
                margin_target=0.50,
                margin_claim=(
                    "Input sheet!B32 is 0.5. todo3 section 3 footnote 1 instructed "
                    "treating 45% as the value actually used and the blog's 50% as "
                    "a text error, pending the spreadsheet. The spreadsheet says "
                    "50%: the blog was right and the footnote's guess was wrong."
                ),
                s2c_early=2.5, s2c_late=1.5,
                s2c_claim=(
                    "Input sheet!B38/C38: 2.5 for years 1-5, 1.5 for years 6-10. "
                    "The June model reverses this to 1.5 then 2.5."
                ),
            ),
            _segment(
                "expansion", _BASE_PRE, revenue_target=50.0,
                revenue_claim="Input sheet!B29. " + _EXPANSION_RAMP,
                revenue_three_p="plausible",
                margin_target=0.30, margin_claim=_EXPANSION_MARGIN,
                margin_three_p="plausible",
                s2c_early=3.0, s2c_late=3.0,
                s2c_claim=(
                    "Input sheet!B39/C39: 3 in both blocks -- the only segment "
                    "whose ratio does not change across the horizon. The June "
                    "model raises it to 5. todo3 section 3 has no "
                    "sales-to-capital row for this segment at all."
                ),
                ramp_start_year=6,
            ),
        ],
    }


def _post_prospectus_payload(parent_case_id: int) -> dict:
    return {
        "case_name": POST_CASE_NAME,
        "ticker": None,
        "as_of_date": "2026-06-01",
        "base_year": 2026,
        "target_year": 2036,
        "riskfree_rate": 0.0456,
        "wacc_initial": 0.083745,
        "wacc_stable": 0.0825,
        "wacc_converge_from": 6,
        "marginal_tax_rate": 0.25,
        "nol_balance": 0.0,
        "roic_stable": 0.15,
        "terminal_growth": None,
        "cash": 24.747,
        "debt": 22.896,
        "ipo_proceeds": 75.0,
        "shares_basic": 12.5353,
        # 766.65m new shares = 75000 / 97.83, the source's own iterated solution
        # (Valuation output!B43 divides proceeds by the value per share it is
        # simultaneously computing). This engine does not iterate, so the
        # source's answer is transcribed rather than reproduced.
        "shares_new": 0.76665,
        "parent_case_id": parent_case_id,
        "segments": [
            _segment(
                "launch", _BASE_POST, tam=100.0, tam_claim=_LAUNCH_TAM,
                share=0.40, share_confidence="derived", share_three_p="plausible",
                share_claim=(
                    "40%, DERIVED: Input sheet!B26 cuts launch's 2036 revenue "
                    "from 70.0 to 40.0, and 40.0 against the blog's confirmed "
                    "$100bn TAM implies a 40% share. todo3 section 3 records "
                    "launch's target revenue as UNCHANGED at $70bn across both "
                    "valuations and its share as 70%; the spreadsheet shows "
                    "otherwise. This near-halving is the largest single revision "
                    "to the launch segment, and todo3's account of why "
                    "enterprise value barely moved omits it entirely."
                ),
                margin_target=0.45,
                margin_claim=(
                    "Input sheet!B30, raised from 40%. Gross margin is ~67% and "
                    "the reported operating loss was entirely R&D-driven."
                ),
                s2c_early=3.0, s2c_late=4.0,
                s2c_claim=(
                    "Input sheet!B36/C36: 3 for years 1-5, 4 for years 6-10. "
                    "Two changes from April, not one -- the early ratio was "
                    "lowered 4 -> 3 (which todo3 I2 records) AND the late ratio "
                    "was RAISED 2 -> 4 (which it does not). Capital intensity "
                    "now falls with scale instead of rising."
                ),
            ),
            _segment(
                "connectivity", _BASE_POST, tam=160.0, tam_claim=_CONN_TAM,
                share=0.75, share_claim=_CONN_SHARE,
                margin_target=0.60, margin_claim=_CONN_MARGIN,
                s2c_early=3.0, s2c_late=5.0,
                s2c_claim=(
                    "Input sheet!B37/C37: 3 for years 1-5, 5 for years 6-10. The "
                    "early ratio falls 10 -> 3 after $14bn of 2025 capex; the "
                    "late ratio is unchanged at 5."
                ),
            ),
            _segment(
                "ai", _BASE_POST, revenue_target=160.0,
                revenue_claim=(
                    "Input sheet!B28, doubled from 80.0 on the Cursor "
                    "acquisition and enterprise intent, against a $3-4T AI TAM. "
                    "The prospectus claim of $26T is rejected as a marketing "
                    "artifact."
                ),
                margin_target=0.25,
                margin_claim=(
                    "Input sheet!B32, cut from 50%. The lowest gross margins of "
                    "the three segments, and deteriorating, under LLM "
                    "competition."
                ),
                s2c_early=1.5, s2c_late=2.5,
                s2c_claim=(
                    "Input sheet!B38/C38: 1.5 for years 1-5, 2.5 for years 6-10 "
                    "-- the April pair reversed. todo3 section 3's \"already "
                    "low, lower still\" covers the early ratio only."
                ),
            ),
            _segment(
                "expansion", _BASE_POST, revenue_target=100.0,
                revenue_claim=(
                    "Input sheet!B29, DOUBLED from 50.0. todo3 section 3 tags "
                    "this segment's target [V] \"assumed unchanged\" in both "
                    "valuations; the spreadsheet shows it was not. " +
                    _EXPANSION_RAMP
                ),
                revenue_three_p="plausible",
                margin_target=0.30, margin_claim=_EXPANSION_MARGIN,
                margin_three_p="plausible",
                s2c_early=5.0, s2c_late=5.0,
                s2c_claim=(
                    "Input sheet!B39/C39: 5 in both blocks, raised from 3. Still "
                    "the only segment whose ratio holds flat across the horizon."
                ),
                ramp_start_year=6,
            ),
        ],
    }


def ensure_valuation_cases_seeded() -> None:
    """Plant the two SpaceX reference cases if they are not already there."""
    existing = {case["case_name"]: case["id"] for case in list_cases()}

    pre_id = existing.get(PRE_CASE_NAME)
    if pre_id is None:
        pre_id = create_case(_pre_prospectus_payload())

    if POST_CASE_NAME not in existing:
        create_case(_post_prospectus_payload(pre_id))
