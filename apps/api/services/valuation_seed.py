"""Damodaran's two SpaceX cases as reference fixtures.

Sourced from `guideline/sop/todo3.md`, which reconstructs his April 2026
pre-prospectus and June 2026 post-prospectus valuations. Both are seeded because
the pair is the point: section 3's finding is that a 277-page prospectus barely
moved enterprise value, because the AI revenue doubling and the launch margin
uplift were almost exactly cancelled by the AI margin collapse.

Confidence tags mirror todo3's own: [C] -> confirmed, [D] -> derived,
[V] -> assumed. Everything tagged `assumed` is a placeholder pending
SpaceX2026IPO.xlsx and SpaceX2026IPOUpdated.xlsx; see the design spec, 7.3.

`roic_stable` is a single literal, `0.33`, shared by both cases rather than a
per-case erosion policy. A per-case value made terminal value a function of the
least-supported inputs in the model and pushed the pre/post EV ratio further
from the source's own finding than a shared value did: per-case gave 0.908,
shared gives 0.978, against the source's 1.008 -- and the whole point of seeding
this pair is that a 277-page prospectus barely moved enterprise value. 0.33 sits
below both cases' marginal returns on new capital and within the engine's
capital-intensity tolerance for both (a terminal ROIC below the marginal one
implies more capital intensity than the target year, and the engine caps that at
60%): +12.6% for the post case, +50.3% for the pre case. A single shared
terminal return means the pre/post comparison reflects the change in business
assumptions between the two valuations, not a per-case terminal parameter moving
underneath it.

Not wired into application startup: fixture data does not belong in a database
unless someone asked for it.
"""

from __future__ import annotations

from apps.api.services.valuation_case import create_case, list_cases

PRE_CASE_NAME = "spacex_2026_04_pre_prospectus"
POST_CASE_NAME = "spacex_2026_06_post_prospectus"

# Base-year (FY2025) figures. Only the TOTAL is derived: todo3 section 6
# derives 2025 revenue twice from trailing multiples -- 1250/80.13 and
# 1750/112.18, both giving 15.60 -- and these four sum to 15.6. The SPLIT
# across segments is an assumption the source does not support. Margins are
# [V] and do not reconcile with either base-year EBIT figure todo3 quotes; see
# the design spec, section 6.
_BASE = {
    "launch": (4.1, -0.10),
    "connectivity": (11.4, 0.02),
    "ai": (0.1, -0.50),
    "expansion": (0.0, 0.0),
}

_BASE_CLAIMS = {
    "launch": (
        "The segment split is an assumption, not a derivation: only the total "
        "2025 revenue (~$15.6bn) is derived, from todo3 section 6's two "
        "trailing-multiple computations (1250/80.13 and 1750/112.18, both "
        "$15.60bn). The 4.1 / 11.4 / 0.1 / 0.0 split across launch, "
        "connectivity, ai and expansion is not supported by the source."
    ),
    "connectivity": (
        "Split assumption -- see the 'launch' claim for the derived total. "
        "Context, not derivation: Starlink reported ~10.3m subscribers at "
        "~$66/mo ARPU in Q1 2026 (10.3e6 x 66 x 12 = $8.16bn annualized), 40% "
        "below this segment's $11.4bn and from a different period than FY2025."
    ),
    "ai": (
        "Split assumption -- see the 'launch' claim for the derived total. No "
        "independent corroboration for the 0.1 figure in the source."
    ),
    "expansion": "No revenue today. The segment is a real-option proxy, not a business.",
}

_ASSUMED_BASE_MARGIN = (
    "Placeholder. todo3 tags base margins [V]; the blog posts give only "
    "consolidated figures, which do not reconcile with each other "
    "(-$2.57bn reported vs +$4bn EBITR vs -$0.23bn implied by these margins)."
)
_ASSUMED_S2C = (
    "Placeholder. todo3 states only the direction -- sales-to-capital was "
    "lowered after $14bn of 2025 capex -- never the level. Calibrate against "
    "SpaceX2026IPOUpdated.xlsx."
)
_PRE_S2C_LATE_CLAIM = (
    "Placeholder, lowered from an earlier draft. The original values (2.0 / 2.0 "
    "/ 1.2 / 1.5) implied a 58% after-tax marginal return in perpetuity, which is "
    "not credible for any business. These stay strictly above the "
    "post-prospectus values (1.5 / 1.5 / 1.0 / 1.5), preserving todo3 section 3's "
    "confirmed record that Damodaran lowered sales-to-capital after the "
    "prospectus. Calibrate against SpaceX2026IPOUpdated.xlsx."
)


def _narrative(field, claim, confidence, three_p="probable", source="todo3"):
    return {
        "input_field": field,
        "claim": claim,
        "evidence_source": source,
        "confidence": confidence,
        "three_p": three_p,
    }


def _segment(name, *, margin_target, margin_claim, s2c_early, s2c_late,
             tam=None, tam_claim=None, share=None, share_claim=None,
             revenue_target=None, revenue_claim=None, ramp_start_year=1,
             margin_confidence="confirmed", margin_three_p="probable",
             revenue_confidence="confirmed", revenue_three_p="probable",
             s2c_late_claim=_ASSUMED_S2C):
    base_revenue, base_margin = _BASE[name]
    narratives = [
        # Retagged assumed/plausible (I9): only the segment TOTAL is derived,
        # the split across segments is an assumption -- see _BASE_CLAIMS.
        _narrative("base_revenue", _BASE_CLAIMS[name], "assumed", three_p="plausible", source="todo3 section 6"),
        _narrative("base_margin", _ASSUMED_BASE_MARGIN, "assumed", three_p="plausible"),
        _narrative("margin_target", margin_claim, margin_confidence, three_p=margin_three_p, source="todo3 section 3"),
        _narrative("sales_to_capital_early", _ASSUMED_S2C, "assumed", three_p="plausible"),
        _narrative("sales_to_capital_late", s2c_late_claim, "assumed", three_p="plausible"),
    ]
    if tam is not None:
        narratives.append(_narrative("tam_target", tam_claim, "confirmed", source="todo3 section 7"))
        narratives.append(_narrative("market_share_target", share_claim, "confirmed", source="todo3 section 7"))
    if revenue_target is not None:
        narratives.append(_narrative("revenue_target", revenue_claim, revenue_confidence, three_p=revenue_three_p, source="todo3 section 7"))

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
        "narratives": narratives,
    }


_LAUNCH_TAM = "The launch market grows from $30bn to $100bn as government and private demand rises. The prospectus TAM is rejected as an over-reach."
_LAUNCH_SHARE = "SpaceX stays dominant but sheds share to security- and nationalism-driven entrants, from over 80% today to 70%."
_CONN_TAM = "Satellite internet goes from 1% to 10% of a $1.5T internet market."
_CONN_SHARE = "Starlink's satellite lead plus captive launch capacity is defensible."
_CONN_MARGIN = "Once satellites are in orbit incremental subscribers are nearly pure margin, and CAC eases as the business mix rises."
_EXPANSION_REVENUE = "A deliberately crude stand-in for optionality, ramping only after year 6. Mars, space tourism and in-space business are excluded outright: no viable revenue path today."
_EXPANSION_MARGIN = "Assumed mid-range for an unspecified business. The segment is a placeholder for optionality, not a forecast."


def _pre_prospectus_payload() -> dict:
    return {
        "case_name": PRE_CASE_NAME,
        "ticker": None,
        "as_of_date": "2026-04-23",
        "base_year": 2026,
        "target_year": 2036,
        "riskfree_rate": 0.0420,
        "wacc_initial": 0.0802,
        "wacc_stable": 0.0800,
        "wacc_converge_from": 6,
        "marginal_tax_rate": 0.25,
        "nol_balance": 5.0,
        "roic_stable": 0.33,
        "terminal_growth": None,
        "cash": 0.0,
        "debt": 0.0,
        "ipo_proceeds": 0.0,
        "shares_basic": 2.467,
        "shares_new": 0.0,
        "parent_case_id": None,
        "segments": [
            _segment("launch", tam=100.0, tam_claim=_LAUNCH_TAM, share=0.70,
                     share_claim=_LAUNCH_SHARE, margin_target=0.40,
                     margin_claim="Reusability and existing infrastructure produce a durable cost advantage.",
                     s2c_early=1.5, s2c_late=1.6, s2c_late_claim=_PRE_S2C_LATE_CLAIM),
            _segment("connectivity", tam=160.0, tam_claim=_CONN_TAM, share=0.75,
                     share_claim=_CONN_SHARE, margin_target=0.60,
                     margin_claim=_CONN_MARGIN, s2c_early=1.5, s2c_late=1.6,
                     s2c_late_claim=_PRE_S2C_LATE_CLAIM),
            # 45%, not 50%. todo3 section 3 footnote 1: S1's text says 50%, S2
            # restates the same assumption as 45%, and section 3's derived table
            # uses 45%. Recorded as derived so the conflict stays visible.
            _segment("ai", revenue_target=80.0,
                     revenue_claim="xAI against a $3-4T real enterprise AI market, before the Cursor acquisition.",
                     margin_target=0.45,
                     margin_claim="Restated from S2 as 45%. S1's text says 50%; todo3 section 3 footnote 1 documents the conflict and its own derived table uses 45%.",
                     margin_confidence="derived",
                     s2c_early=0.8, s2c_late=1.05, s2c_late_claim=_PRE_S2C_LATE_CLAIM),
            # todo3 section 3 tags both revenue_target and margin_target `[V]`
            # ("assumed unchanged") for expansion in BOTH cases -- not confirmed.
            _segment("expansion", revenue_target=50.0, revenue_claim=_EXPANSION_REVENUE,
                     margin_target=0.30, margin_claim=_EXPANSION_MARGIN,
                     s2c_early=1.0, s2c_late=1.5, ramp_start_year=7,
                     s2c_late_claim=_PRE_S2C_LATE_CLAIM,
                     revenue_confidence="assumed", revenue_three_p="plausible",
                     margin_confidence="assumed", margin_three_p="plausible"),
        ],
    }


def _post_prospectus_payload(parent_case_id: int) -> dict:
    return {
        "case_name": POST_CASE_NAME,
        "ticker": None,
        "as_of_date": "2026-06-04",
        "base_year": 2026,
        "target_year": 2036,
        "riskfree_rate": 0.0456,
        "wacc_initial": 0.0837,
        "wacc_stable": 0.0825,
        "wacc_converge_from": 6,
        "marginal_tax_rate": 0.25,
        "nol_balance": 5.0,
        "roic_stable": 0.33,
        "terminal_growth": None,
        "cash": 24.7,
        "debt": 22.9,
        "ipo_proceeds": 75.0,
        "shares_basic": 12.535,
        "shares_new": 0.556,
        "parent_case_id": parent_case_id,
        "segments": [
            _segment("launch", tam=100.0, tam_claim=_LAUNCH_TAM, share=0.70,
                     share_claim=_LAUNCH_SHARE, margin_target=0.45,
                     margin_claim="Raised from 40%. Gross margin is ~67% and the reported operating loss was entirely R&D-driven.",
                     s2c_early=1.0, s2c_late=1.5),
            _segment("connectivity", tam=160.0, tam_claim=_CONN_TAM, share=0.75,
                     share_claim=_CONN_SHARE, margin_target=0.60,
                     margin_claim=_CONN_MARGIN + " Held at 60%: gross margin went 37% to 48% across 2024-2025.",
                     s2c_early=1.0, s2c_late=1.5),
            _segment("ai", revenue_target=160.0,
                     revenue_claim="Doubled from $80bn on the Cursor acquisition and enterprise intent, against a $3-4T AI TAM. The prospectus claim of $26T is rejected as a marketing artifact.",
                     margin_target=0.25,
                     margin_claim="Cut from 45%. The lowest gross margins of the three segments, and deteriorating, under LLM competition.",
                     s2c_early=0.6, s2c_late=1.0),
            # todo3 section 3 tags both revenue_target and margin_target `[V]`
            # ("assumed unchanged") for expansion in BOTH cases -- not confirmed.
            _segment("expansion", revenue_target=50.0, revenue_claim=_EXPANSION_REVENUE,
                     margin_target=0.30, margin_claim=_EXPANSION_MARGIN,
                     s2c_early=1.0, s2c_late=1.5, ramp_start_year=7,
                     revenue_confidence="assumed", revenue_three_p="plausible",
                     margin_confidence="assumed", margin_three_p="plausible"),
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
