from apps.api.services.industry_maps import (
    EXCLUDED_ROWS,
    SECTOR_TO_INDUSTRIES,
    YAHOO_TO_DAMODARAN,
    damodaran_industry_for_yahoo,
    sector_for_industry,
)


def test_no_industry_is_claimed_by_two_sectors():
    """An industry in two sectors would make `sector_for_industry` order-dependent."""
    seen: dict[str, str] = {}
    for sector, industries in SECTOR_TO_INDUSTRIES.items():
        for industry in industries:
            assert industry not in seen, f"{industry} in both {seen.get(industry)} and {sector}"
            seen[industry] = sector


def test_every_sector_has_at_least_three_industries():
    """resolve_benchmark requires three surviving industries. A sector that
    cannot reach three is a mapping error, not a runtime condition."""
    for sector, industries in SECTOR_TO_INDUSTRIES.items():
        assert len(industries) >= 3, f"{sector} has {len(industries)}"


def test_technology_contains_the_worked_example_industries():
    tech = SECTOR_TO_INDUSTRIES["Technology"]
    for name in ("Computers/Peripherals", "Software (System & Application)",
                 "Semiconductor Equip", "Semiconductor", "Software (Internet)"):
        assert name in tech


def test_sector_lookup_round_trips():
    assert sector_for_industry("Semiconductor") == "Technology"
    assert sector_for_industry("Not An Industry") is None


def test_aggregate_rows_are_excluded_explicitly():
    """The dataset's largest firm count is 5994 against a median of 34 -- a
    market total, not an industry. Firm-count screening cannot catch it because
    it screens HIGH, so exclusion is by name."""
    assert "Total Market" in EXCLUDED_ROWS
    assert sector_for_industry("Total Market") is None


def test_yahoo_industries_map_to_real_damodaran_industries():
    """A typo in the right-hand side would resolve to a sector of None at
    runtime and silently disable the whole feature for that ticker."""
    known = {i for industries in SECTOR_TO_INDUSTRIES.values() for i in industries}
    for yahoo, damodaran in YAHOO_TO_DAMODARAN.items():
        assert damodaran in known, f"{yahoo} -> {damodaran} is not a mapped industry"


def test_yahoo_lookup_is_case_and_space_insensitive():
    assert damodaran_industry_for_yahoo("semiconductors") == "Semiconductor"
    assert damodaran_industry_for_yahoo("  Semiconductors  ") == "Semiconductor"
    assert damodaran_industry_for_yahoo("Nonexistent Industry") is None
