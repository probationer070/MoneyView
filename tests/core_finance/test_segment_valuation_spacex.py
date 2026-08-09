"""Confirmed-input gates for Damodaran's two SpaceX cases.

Everything asserted here is determined by inputs todo3 tags as confirmed. The
revenue path terminates on `target_revenue` by construction and phi(n) = 0 makes
the final margin equal `margin_target`, so target-year revenue and EBIT are
functions of TAM, market share and target margin alone -- independent of the
base margins, sales-to-capital ratios, tax rate and NOL balance, all of which
are guesses pending the spreadsheets.

Enterprise value is deliberately NOT asserted. See the design spec, section 1.2.

This case data will also live in `apps/api/services/valuation_seed.py` (a later
task), and the duplication is deliberate. These gates test the engine, which
lives in `packages/core_finance` and must not import from `apps/api` -- the
dependency runs one way (guideline/sop/file-structure.md:42). Importing the seed
here would invert it, and dropping these gates in favour of the seed's would
leave the engine with no acceptance test at its own commit.
"""

import pytest

from packages.core_finance.segment_valuation import CaseSpec, SegmentSpec, run_case

# Base-year (FY2025) revenues. Derived, not stated -- but corroborated twice by
# todo3 section 6: 1250 / 80.13 = 15.60 and 1750 / 112.18 = 15.60, both of which
# match the 4.1 + 11.4 + 0.1 + 0 = 15.6 suggested in section 9.4.
BASE_REVENUE = {"launch": 4.1, "connectivity": 11.4, "ai": 0.1, "expansion": 0.0}
BASE_MARGIN = {"launch": -0.10, "connectivity": 0.02, "ai": -0.50, "expansion": 0.0}


def _segment(name, *, margin_target, s2c_early, s2c_late, **endpoint) -> SegmentSpec:
    return SegmentSpec(
        name=name,
        base_revenue=BASE_REVENUE[name],
        base_margin=BASE_MARGIN[name],
        margin_target=margin_target,
        sales_to_capital_early=s2c_early,
        sales_to_capital_late=s2c_late,
        ramp_start_year=7 if name == "expansion" else 1,
        **endpoint,
    )


def pre_prospectus() -> tuple[CaseSpec, list[SegmentSpec]]:
    case = CaseSpec(
        base_year=2026, target_year=2036,
        riskfree_rate=0.0420, wacc_initial=0.0802, wacc_stable=0.0800,
        wacc_converge_from=6, marginal_tax_rate=0.25, nol_balance=5.0,
        roic_stable=0.12,
        cash=0.0, debt=0.0, ipo_proceeds=0.0,
        shares_basic=2.467, shares_new=0.0,
    )
    segments = [
        _segment("launch", tam_target=100.0, market_share_target=0.70,
                 margin_target=0.40, s2c_early=1.5, s2c_late=2.0),
        _segment("connectivity", tam_target=160.0, market_share_target=0.75,
                 margin_target=0.60, s2c_early=1.5, s2c_late=2.0),
        # 45%, not 50%. todo3 section 3 footnote 1 documents the conflict: S1's
        # text says 50%, S2 restates the same assumption as 45%, and section 3's
        # own derived table uses 45%.
        _segment("ai", revenue_target=80.0, margin_target=0.45,
                 s2c_early=0.8, s2c_late=1.2),
        _segment("expansion", revenue_target=50.0, margin_target=0.30,
                 s2c_early=1.0, s2c_late=1.5),
    ]
    return case, segments


def post_prospectus() -> tuple[CaseSpec, list[SegmentSpec]]:
    case = CaseSpec(
        base_year=2026, target_year=2036,
        riskfree_rate=0.0456, wacc_initial=0.0837, wacc_stable=0.0825,
        wacc_converge_from=6, marginal_tax_rate=0.25, nol_balance=5.0,
        roic_stable=0.12,
        cash=24.7, debt=22.9, ipo_proceeds=75.0,
        shares_basic=12.535, shares_new=0.556,
    )
    segments = [
        _segment("launch", tam_target=100.0, market_share_target=0.70,
                 margin_target=0.45, s2c_early=1.0, s2c_late=1.5),
        _segment("connectivity", tam_target=160.0, market_share_target=0.75,
                 margin_target=0.60, s2c_early=1.0, s2c_late=1.5),
        _segment("ai", revenue_target=160.0, margin_target=0.25,
                 s2c_early=0.6, s2c_late=1.0),
        _segment("expansion", revenue_target=50.0, margin_target=0.30,
                 s2c_early=1.0, s2c_late=1.5),
    ]
    return case, segments


def test_pre_prospectus_target_year_totals():
    """todo3 section 3: $320bn revenue, $151bn EBIT in 2036."""
    case, segments = pre_prospectus()
    result = run_case(case, segments)
    assert result.revenue[-1] == pytest.approx(320.0, abs=1e-6)
    assert result.ebit[-1] == pytest.approx(151.0, abs=1e-6)


def test_post_prospectus_target_year_totals():
    """todo3 section 3: $400bn revenue, $158.5bn EBIT in 2036."""
    case, segments = post_prospectus()
    result = run_case(case, segments)
    assert result.revenue[-1] == pytest.approx(400.0, abs=1e-6)
    assert result.ebit[-1] == pytest.approx(158.5, abs=1e-6)


def test_pre_prospectus_revenue_matches_the_forward_multiple():
    """Independent corroboration: todo3 section 6 quotes a 3.91x forward
    EV/Sales at a $1.25T price, and 1250 / 3.91 = 319.7."""
    case, segments = pre_prospectus()
    result = run_case(case, segments)
    assert result.revenue[-1] == pytest.approx(1250 / 3.91, rel=0.002)


def test_base_revenue_reconciles_with_trailing_multiples():
    """todo3 section 6 derives 2025 revenue twice: 1250/80.13 and 1750/112.18."""
    for builder in (pre_prospectus, post_prospectus):
        case, segments = builder()
        result = run_case(case, segments)
        assert result.base_revenue_total == pytest.approx(15.6, abs=0.05)
        assert result.base_revenue_total == pytest.approx(1250 / 80.13, abs=0.05)
        assert result.base_revenue_total == pytest.approx(1750 / 112.18, abs=0.05)


def test_offsetting_changes_barely_move_target_year_ebit():
    """todo3 section 3's central finding: AI revenue doubling and the launch
    margin uplift are almost exactly cancelled by the AI margin collapse. A
    277-page prospectus moved target-year EBIT by under 5%."""
    pre = run_case(*pre_prospectus())
    post = run_case(*post_prospectus())
    assert post.revenue[-1] / pre.revenue[-1] == pytest.approx(1.25, abs=0.01)
    assert abs(post.ebit[-1] / pre.ebit[-1] - 1) < 0.05


def test_expansion_segment_contributes_nothing_before_2032():
    """todo3 R5: the real-option proxy ramps only after year 6."""
    case, segments = post_prospectus()
    result = run_case(case, segments)
    expansion = next(s for s in result.segments if s.name == "expansion")
    assert expansion.revenue[:6] == [0.0] * 6
    assert expansion.ebit[:6] == [0.0] * 6
    assert expansion.reinvestment[:6] == [0.0] * 6
    assert expansion.revenue[-1] == pytest.approx(50.0)
