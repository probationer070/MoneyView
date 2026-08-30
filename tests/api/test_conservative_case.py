import pytest

from apps.api.services.conservative_case import CompanyBaseline, build_conservative_case
from apps.api.services.valuation_case import create_case, run_stored_case
from packages.core_finance.industry_benchmark import ColumnAverage, SectorBenchmark
from packages.core_finance.segment_valuation import CaseSpec, SegmentSpec, run_case


def _benchmark(**overrides):
    base = {
        "revenue_growth": 0.08, "operating_margin": 0.15, "after_tax_roc": 0.20,
        "effective_tax_rate": 0.22, "unlevered_beta": 1.3, "debt_to_capital": 0.25,
        "cost_of_capital": 0.095, "sales_to_capital": 2.0, "reinvestment_rate": 0.40,
    }
    base.update(overrides)
    return SectorBenchmark(
        sector="Technology",
        columns={k: ColumnAverage(v, ("Computers/Peripherals", "Semiconductor", "Semiconductor Equip"))
                 for k, v in base.items()},
        ranked=("Computers/Peripherals", "Semiconductor", "Semiconductor Equip"),
        rejected=(),
    )


def _baseline(**overrides):
    base = dict(base_revenue=100.0, base_margin=0.30, current_roic=0.35,
                current_sales_to_capital=3.0, current_growth=0.20,
                current_wacc=0.085,
                cash=20.0, debt=5.0, shares=1.0, source_years=(2024, 2025))
    base.update(overrides)
    return CompanyBaseline(**base)


def _build(**kw):
    return build_conservative_case(
        "TEST", _baseline(**kw.pop("baseline", {})), kw.pop("benchmark", _benchmark()),
        vintage="2026-01-01", riskfree_rate=0.04, marginal_tax_rate=0.25, base_year=2026,
    )


def _run(case):
    spec = CaseSpec(**{k: v for k, v in case.items()
                       if k in CaseSpec.__dataclass_fields__})
    segments = [SegmentSpec(**{k: v for k, v in s.items()
                               if k in SegmentSpec.__dataclass_fields__})
                for s in case["segments"]]
    return run_case(spec, segments)


def test_a_margin_above_the_benchmark_becomes_the_benchmark():
    """30% company against a 15% sector: the TARGET is 15%. The engine then
    ramps from the company's actual 30% base_margin down to it."""
    case = _build()
    segment = case["segments"][0]
    assert segment["margin_target"] == pytest.approx(0.15)
    assert segment["base_margin"] == pytest.approx(0.30)


def test_a_margin_below_the_benchmark_holds_and_is_not_assumed_to_improve():
    case = _build(baseline={"base_margin": 0.09})
    assert case["segments"][0]["margin_target"] == pytest.approx(0.09)


def test_terminal_roic_takes_the_worse_of_company_and_sector():
    case = _build()
    assert case["roic_stable"] == pytest.approx(0.20)


def test_sales_to_capital_fades_down_because_a_higher_ratio_is_a_benefit():
    """A HIGHER sales/capital means LESS capital per dollar of new revenue, so
    it is a benefit and fades down. Backwards, this makes capital-hungry
    companies look cheaper."""
    segment = _build()["segments"][0]
    assert segment["sales_to_capital_early"] == pytest.approx(2.0)
    assert segment["sales_to_capital_late"] == pytest.approx(2.0)


def test_a_company_below_the_sector_sales_to_capital_holds():
    segment = _build(baseline={"current_sales_to_capital": 1.2})["segments"][0]
    assert segment["sales_to_capital_early"] == pytest.approx(1.2)


def test_the_tax_rate_fades_up_toward_a_higher_sector_rate():
    case = _build(benchmark=_benchmark(effective_tax_rate=0.30))
    assert case["effective_tax_rate"] == pytest.approx(0.30)


def test_a_sector_tax_rate_below_the_marginal_rate_holds_at_the_marginal_rate():
    """`effective_tax_rate` is `higher_is_conservative`, and the company's own
    endpoint is the marginal rate -- assuming no tax benefit it has not
    demonstrated. A sector averaging BELOW the marginal rate can only lift the
    early years' cash flow, so it holds rather than fading down.

    The task brief asserted 0.22 here (the sector value) with the marginal rate
    at 0.25. That would fade toward optimism, which `fade` refuses by design and
    which this whole feature exists to prevent."""
    case = _build(benchmark=_benchmark(effective_tax_rate=0.22))
    assert case["effective_tax_rate"] == pytest.approx(0.25)


def test_the_cost_of_capital_fades_up_toward_the_sector():
    case = _build()
    assert case["wacc_stable"] == pytest.approx(0.095)


def test_a_company_costlier_than_its_sector_keeps_its_own_cost_of_capital():
    """The sector average is a FLOOR on the cost of capital, not a ceiling.

    `cost_of_capital` fades `higher_is_conservative`, so a company already
    raising capital more expensively than its sector keeps its own number rather
    than being handed the sector's cheaper one. This is the usual case, not the
    exotic one: across the real 2026 vintage only Technology's average (0.0959)
    sits above a typical large-cap's own cost of capital, so for the other ten
    sectors the company's measured WACC is what discounts the case. That is
    exactly why this field takes a measured input -- an invented company-side
    placeholder would override the benchmark almost everywhere instead of being
    overridden by it.
    """
    case = _build(baseline={"current_wacc": 0.11})
    assert case["wacc_stable"] == pytest.approx(0.11)
    assert case["wacc_initial"] == pytest.approx(0.11)


def test_revenue_target_compounds_the_faded_growth_over_ten_years():
    """Company grows 20%, sector 8%. The conservative target uses 8%."""
    case = _build()
    assert case["segments"][0]["revenue_target"] == pytest.approx(100.0 * 1.08 ** 10)
    assert case["target_year"] - case["base_year"] == 10


def test_the_equity_bridge_is_reconstructed_from_net_debt():
    case = _build(baseline={"cash": 0.0, "debt": 30.0})
    assert case["debt"] == pytest.approx(30.0)
    assert case["cash"] == pytest.approx(0.0)
    assert case["ipo_proceeds"] == 0.0
    assert case["shares_new"] == 0.0


def test_every_segment_input_carries_a_derived_narrative():
    """create_case rejects any narrated input without a claim, so this is what
    makes the generated case storable at all. Nothing is `confirmed`: the
    benchmark is a real average, but applying it to THIS company is inference."""
    segment = _build()["segments"][0]
    claims = {n["input_field"]: n for n in segment["narratives"]}
    for field in ("base_revenue", "base_margin", "revenue_target", "margin_target",
                  "sales_to_capital_early", "sales_to_capital_late"):
        assert field in claims, field
        assert claims[field]["confidence"] == "derived"
    # `base_revenue`/`base_margin` never touch the benchmark -- they come from
    # the company's own stored statements -- so they must not be attributed to
    # the Damodaran vintage like the four benchmark-derived fields are.
    for field in ("base_revenue", "base_margin"):
        assert claims[field]["evidence_source"] == "stored_statements", field
    for field in ("revenue_target", "margin_target",
                  "sales_to_capital_early", "sales_to_capital_late"):
        assert claims[field]["evidence_source"] == "damodaran_industry_2026-01-01", field


def test_narratives_name_the_industries_behind_the_number():
    """Provenance is the point. A benchmark that arrives as a bare number is
    untraceable when it later looks wrong."""
    segment = _build()["segments"][0]
    claim = next(n for n in segment["narratives"] if n["input_field"] == "margin_target")["claim"]
    assert "Computers/Peripherals" in claim
    assert "Technology" in claim
    assert "2026-01-01" in claim


def test_the_generated_case_runs_and_produces_a_positive_value():
    result = _run(_build())
    assert result.enterprise_value > 0
    assert result.revenue[-1] == pytest.approx(100.0 * 1.08 ** 10)


def test_money_terms_are_in_billions_not_raw_currency():
    """A units error here is a 10^9 error. base_revenue for a $100bn company is
    100.0."""
    assert _build()["segments"][0]["base_revenue"] == pytest.approx(100.0)


def test_generating_twice_from_the_same_inputs_is_reproducible():
    first, second = _build(), _build()
    assert first["segments"][0] == second["segments"][0]
    assert {k: v for k, v in first.items() if k != "segments"} == \
           {k: v for k, v in second.items() if k != "segments"}


def test_a_dropped_benchmark_column_still_states_why_the_value_was_not_faded():
    """An empty claim would be worse than a refusal: it stores a number that
    LOOKS justified and is not.

    `resolve_benchmark` omits any column with too few surviving industries, so a
    benchmark can arrive missing one. The affected fields then hold the
    company's own value, which is the right number -- but a blank claim clears
    both gates that are supposed to catch an unjustified input:
    `_validate_narratives` only checks the field is named, and `claim` is
    `TEXT NOT NULL`, which an empty string satisfies. The case stores, reads
    back as fully narrated, and silently asserts nothing.
    """
    benchmark = _benchmark()
    del benchmark.columns["operating_margin"]
    del benchmark.columns["sales_to_capital"]

    case = _build(benchmark=benchmark)
    segment = case["segments"][0]
    claims = {n["input_field"]: n for n in segment["narratives"]}

    for field, column in (("margin_target", "operating_margin"),
                          ("sales_to_capital_early", "sales_to_capital"),
                          ("sales_to_capital_late", "sales_to_capital")):
        assert claims[field]["claim"].strip(), field
        assert column in claims[field]["claim"], field
        # A held company value has no sector corroboration, so it is a weaker
        # claim than a benchmarked one.
        assert claims[field]["three_p"] == "plausible", field

    # The values are the company's own, held flat -- unfaded, not defaulted.
    assert segment["margin_target"] == pytest.approx(0.30)
    assert segment["sales_to_capital_early"] == pytest.approx(3.0)
    assert segment["sales_to_capital_late"] == pytest.approx(3.0)

    assert create_case(case) > 0


def test_full_basket_ignores_columns_the_case_does_not_consume():
    """Task 3 review finding: `benchmark.columns` now carries trailing_pe,
    price_to_book, ev_sales and stdev_price alongside the columns this case
    actually fades, and none of the four feed a fade. If `full_basket` counted
    them, a well-populated price column would raise `full_basket` above the
    fade columns' own basket size and silently downgrade every fade's
    `three_p` from "probable" to "plausible" -- a confidence label depending
    on a column the case never consumes. Here trailing_pe rests on five
    industries while every fade-consumed column rests on the usual three."""
    benchmark = _benchmark()
    benchmark.columns["trailing_pe"] = ColumnAverage(
        18.0, ("Computers/Peripherals", "Semiconductor", "Semiconductor Equip",
               "Extra Industry 1", "Extra Industry 2"),
    )

    case = _build(benchmark=benchmark)
    claims = {n["input_field"]: n for n in case["segments"][0]["narratives"]}
    assert claims["margin_target"]["three_p"] == "probable"
    assert claims["sales_to_capital_early"]["three_p"] == "probable"


def test_the_payload_is_storable_and_runnable_through_the_case_store():
    """The generator's whole output contract is "a `create_case` payload", and
    only `create_case` can say whether it is one -- it enforces the narrative
    rule, the column set and the three_p/confidence CHECK constraints that the
    dict alone cannot show."""
    case_id = create_case(_build())
    assert run_stored_case(case_id)["enterprise_value"] > 0


def test_a_sector_roc_above_the_implied_marginal_return_is_capped_at_it():
    """The worse of two independent estimates of the same return, not a clamp.

    Damodaran's "After-tax ROC" is a BOOK return on EXISTING capital;
    `margin x (1 - tau) x sales_to_capital` is the return on NEW capital implied
    by the same table's margin and capital intensity. Where the first exceeds
    the second the book capital base is understated relative to what the
    industry's own margin and turnover generate on new investment, and carrying
    the higher figure as a TERMINAL return would assert the terminal block earns
    more on new capital than the model itself supports.

    Real Financials, 2026 vintage: a faded ROC of 0.2200 against an implied
    marginal return of 0.1932. Here: 0.234 against 0.15 x 0.75 x 2.0 = 0.225.
    Without this, five of the eleven real sectors produce nothing.
    """
    case = _build(benchmark=_benchmark(after_tax_roc=0.234))
    assert case["roic_stable"] == pytest.approx(0.15 * 0.75 * 2.0)
    assert _run(case).enterprise_value > 0


def test_a_sector_earning_below_its_cost_of_capital_is_refused_not_adjusted():
    """The cap does NOT rescue this, and must not.

    Real Estate, 2026 vintage: a capped terminal return of 0.0531 against a
    faded cost of capital of 0.0607. `terminal_value` rejects a positive-growth
    perpetuity whose return sits at or below its cost of capital, and it is
    right to -- such a perpetuity destroys value as it grows. The difference
    from the Financials case above is that nothing here is an accounting
    mismatch between two measures of one quantity; the sector's top industries
    genuinely earn less than their capital costs, and refusing says so. Moving
    the number until the guard passes would replace an economic statement about
    the sector with false precision.

    Reproduced here at this fixture's own levels rather than Real Estate's: the
    implied marginal return is 0.06 x 0.75 x 2.0 = 0.09, so the cap does not
    bind and `roic_stable` is the sector's own 0.05 -- below the 0.095 cost of
    capital. Same mechanism, different absolute level.
    """
    case = _build(
        baseline={"base_margin": 0.06, "current_roic": 0.05},
        benchmark=_benchmark(operating_margin=0.06, after_tax_roc=0.053),
    )
    assert case["roic_stable"] == pytest.approx(0.05)
    assert case["wacc_stable"] == pytest.approx(0.095)
    with pytest.raises(ValueError, match="must exceed wacc_stable"):
        _run(case)


from apps.api.services.industry_benchmark_store import resolve_for_ticker, store_vintage
from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS


def _seed_quote_facts(ticker, industry):
    from apps.api.services.db import get_db
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO corporate_quote_facts "
            "(ticker, market_cap, shares_outstanding, currency, beta, sector, industry, fetched_at) "
            "VALUES (?, 1.0, 1.0, 'USD', 1.0, 'Technology', ?, '2026-01-01')",
            (ticker.upper(), industry),
        )


def test_a_mapped_ticker_resolves_a_benchmark_with_provenance():
    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    _seed_quote_facts("NVDA", "Semiconductors")
    benchmark, vintage, reason = resolve_for_ticker("NVDA")
    assert reason is None
    assert benchmark.sector == "Technology"
    assert benchmark.ranked[0] == "Computers/Peripherals"


def test_the_returned_vintage_matches_the_one_the_benchmark_was_resolved_from():
    """`build_conservative_case` stamps this vintage into `case_name` and every
    `evidence_source`; it must be the vintage the benchmark actually came from,
    not one recomputed by a second `latest_vintage()` call that could race a
    concurrent store."""
    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    _seed_quote_facts("NVDA", "Semiconductors")
    _, vintage, reason = resolve_for_ticker("NVDA")
    assert reason is None
    assert vintage == "2026-01-01"


def test_no_vintage_gives_a_reason_not_a_benchmark():
    _seed_quote_facts("NVDA", "Semiconductors")
    benchmark, vintage, reason = resolve_for_ticker("NVDA")
    assert benchmark is None
    assert vintage is None
    assert "no_vintage" in reason


def test_a_ticker_with_no_industry_gives_a_reason():
    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    _seed_quote_facts("XYZ", "")
    benchmark, vintage, reason = resolve_for_ticker("XYZ")
    assert benchmark is None
    assert vintage is None
    assert "no_industry" in reason


def test_an_unmapped_industry_names_the_value_so_the_map_can_be_extended():
    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    _seed_quote_facts("XYZ", "Llama Farming")
    benchmark, vintage, reason = resolve_for_ticker("XYZ")
    assert benchmark is None
    assert vintage is None
    assert "unmapped_industry" in reason
    assert "Llama Farming" in reason


def test_a_sector_too_thin_to_benchmark_gives_a_reason():
    store_vintage("2026-01-01", [TECHNOLOGY_ROWS[0]])
    _seed_quote_facts("NVDA", "Semiconductors")
    benchmark, vintage, reason = resolve_for_ticker("NVDA")
    assert benchmark is None
    assert vintage is None
    assert "sector_too_thin" in reason
