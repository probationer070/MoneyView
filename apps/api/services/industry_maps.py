"""Sector groupings over Damodaran's industries, and Yahoo's names mapped onto them.

BOTH MAPS ARE JUDGEMENT, NOT FACT. Damodaran's dataset has no sector column, and
Yahoo's industry taxonomy is not his. These are opinions, checked in so they can
be reviewed and argued with rather than embedded as constants somewhere they
would look like acquired data.

A wrong mapping produces a confidently wrong benchmark, and nothing downstream
detects it -- only review does. Every resolved benchmark therefore carries its
provenance, so a surprising number can be traced back to the industries behind
it and, from there, to a line in this file.

Industry names are the source sheet's, verbatim, including its misspellings
("Heathcare Information and Technology") and its missing space ("Rubber& Tires").
A corrected name here does not raise -- it resolves to no sector and silently
disables benchmarking for every ticker in that industry.

The groupings are GICS-shaped because that is the vocabulary a reader brings,
but Damodaran's rows do not partition the way GICS sectors do, and where they
disagree the choice is commented at the line that makes it.
"""

from __future__ import annotations

# Rows in the source sheet that are not industries. Firm-count screening cannot
# reject these -- they screen high, not low -- so they are named. 5994 and 4822
# firms against a median of 34: they are the sheet's own totals, and averaging a
# sector that contained one would benchmark a company against the whole market.
EXCLUDED_ROWS = frozenset({
    "Total Market",
    "Total Market (without financials)",
})

SECTOR_TO_INDUSTRIES: dict[str, tuple[str, ...]] = {
    "Technology": (
        "Computers/Peripherals",
        "Software (System & Application)",
        "Software (Entertainment)",
        "Software (Internet)",
        "Semiconductor",
        "Semiconductor Equip",
        "Computer Services",
        "Information Services",
        "Electronics (General)",
        "Telecom. Equipment",
        "Heathcare Information and Technology",  # source spelling, kept verbatim
    ),
    "Communication Services": (
        "Advertising",
        "Broadcasting",
        "Cable TV",
        "Entertainment",
        "Publishing & Newspapers",
        "Telecom (Wireless)",
        "Telecom. Services",
    ),
    "Financials": (
        "Bank (Money Center)",
        "Banks (Regional)",
        "Brokerage & Investment Banking",
        # Arguable. Damodaran's residual financial bucket -- consumer lenders,
        # card networks, exchanges, mortgage finance. Its economics (spread and
        # fee income, balance-sheet leverage) are a bank's, not a business
        # service's, so it sits with Financials rather than Industrials even
        # though "Svcs." invites the other reading.
        "Financial Svcs. (Non-bank & Insurance)",
        "Insurance (General)",
        "Insurance (Life)",
        "Insurance (Prop/Cas.)",
        "Investments & Asset Management",
        # One firm in the 2026 vintage. Kept as an industry rather than excluded:
        # it is a real line of business, and the row screens out downstream on
        # firm count, which is the control designed for thin rows.
        "Reinsurance",
    ),
    "Energy": (
        "Coal & Related Energy",
        "Oil/Gas (Integrated)",
        "Oil/Gas (Production and Exploration)",
        # Arguable. Midstream pipelines and gas distributors. GICS splits these
        # between Energy and Utilities; Damodaran keeps one row, and its betas
        # and reinvestment look like Energy's, so it goes here whole.
        "Oil/Gas Distribution",
        "Oilfield Svcs/Equip.",
    ),
    "Healthcare": (
        "Drugs (Biotechnology)",
        "Drugs (Pharmaceutical)",
        "Healthcare Products",
        "Healthcare Support Services",
        "Hospitals/Healthcare Facilities",
    ),
    "Industrials": (
        "Aerospace/Defense",
        "Air Transport",
        "Business & Consumer Services",
        "Construction Supplies",
        # Arguable. Conglomerates and holding companies. Not an aggregate row --
        # 20 firms, in line with the median -- but it is a structure rather than
        # a business, so any sector is a compromise. Industrials is where the
        # US conglomerates that carry this label actually operate.
        "Diversified",
        "Electrical Equipment",
        "Engineering/Construction",
        "Environmental & Waste Services",
        "Machinery",
        # Copiers, printers, office supplies. GICS calls this Commercial
        # Services & Supplies, which is Industrials, not Technology -- the
        # margins and growth are a supplier's, not a hardware maker's.
        "Office Equipment & Services",
        "Shipbuilding & Marine",
        "Transportation",
        "Transportation (Railroads)",
        "Trucking",
    ),
    "Consumer Discretionary": (
        "Apparel",
        "Auto & Truck",
        "Auto Parts",
        "Education",
        # Consumer electronics and office electronics. Technology's membership
        # is fixed by the worked example and does not include this row; GICS
        # would call the consumer half Household Durables anyway.
        "Electronics (Consumer & Office)",
        "Furn/Home Furnishings",
        "Homebuilding",
        "Hotel/Gaming",
        "Recreation",
        "Restaurant/Dining",
        "Retail (Automotive)",
        "Retail (Building Supply)",
        # Arguable. Damodaran's distributor row mixes consumer and industrial
        # wholesalers. Grouped with the other Retail rows so the whole family
        # stays in one sector rather than being split on a judgement call.
        "Retail (Distributors)",
        "Retail (General)",
        "Retail (Special Lines)",
        "Rubber& Tires",  # source spelling, missing space, kept verbatim
        "Shoe",
    ),
    "Consumer Staples": (
        "Beverage (Alcoholic)",
        "Beverage (Soft)",
        # Growers and producers, not fertilizer makers -- those are chemicals
        # and sit in Materials.
        "Farming/Agriculture",
        "Food Processing",
        "Food Wholesalers",
        "Household Products",
        # The only Retail row that is staples rather than discretionary: grocers
        # sell what people buy in a recession.
        "Retail (Grocery and Food)",
        "Tobacco",
    ),
    "Materials": (
        # Arguable. Cement, aggregates and glass. GICS splits building products
        # (Industrials) from construction materials (Materials); Damodaran has
        # both this row and "Construction Supplies", so the split is read as
        # materials here and products/supplies in Industrials.
        "Building Materials",
        "Chemical (Basic)",
        "Chemical (Diversified)",
        "Chemical (Specialty)",
        "Metals & Mining",
        "Packaging & Container",
        "Paper/Forest Products",
        "Precious Metals",
        "Steel",
    ),
    "Real Estate": (
        "R.E.I.T.",
        "Real Estate (Development)",
        "Real Estate (General/Diversified)",
        "Real Estate (Operations & Services)",
        # A REIT that owns malls is a landlord, not a retailer. Kept with the
        # other property rows despite the name.
        "Retail (REITs)",
    ),
    "Utilities": (
        # Arguable. Solar developers and independent renewable producers. Read
        # as regulated-adjacent power generation (GICS Renewable Electricity)
        # rather than Energy, whose rows are all hydrocarbons.
        "Green & Renewable Energy",
        "Power",
        "Utility (General)",
        "Utility (Water)",
    ),
}

# Keys are lowercase; `damodaran_industry_for_yahoo` lowercases before lookup.
# Coverage is deliberately partial -- Yahoo's taxonomy has labels with no honest
# Damodaran counterpart, and no benchmark is better than a wrong one.
YAHOO_TO_DAMODARAN: dict[str, str] = {
    # Technology
    "semiconductors": "Semiconductor",
    "semiconductor equipment & materials": "Semiconductor Equip",
    "software - infrastructure": "Software (System & Application)",
    "software - application": "Software (System & Application)",
    "consumer electronics": "Computers/Peripherals",
    "computer hardware": "Computers/Peripherals",
    "information technology services": "Computer Services",
    "communication equipment": "Telecom. Equipment",
    "electronic components": "Electronics (General)",
    "scientific & technical instruments": "Electronics (General)",
    "health information services": "Heathcare Information and Technology",
    "internet content & information": "Software (Internet)",
    "electronic gaming & multimedia": "Software (Entertainment)",
    "electronics & computer distribution": "Retail (Distributors)",
    # Yahoo files solar under Technology; Damodaran has a row for it.
    "solar": "Green & Renewable Energy",
    # Communication Services
    "advertising agencies": "Advertising",
    "broadcasting": "Broadcasting",
    "entertainment": "Entertainment",
    "publishing": "Publishing & Newspapers",
    "telecom services": "Telecom. Services",
    # Financials
    "banks - diversified": "Bank (Money Center)",
    "banks - regional": "Banks (Regional)",
    "capital markets": "Brokerage & Investment Banking",
    "asset management": "Investments & Asset Management",
    "insurance - life": "Insurance (Life)",
    "insurance - property & casualty": "Insurance (Prop/Cas.)",
    "insurance - specialty": "Insurance (Prop/Cas.)",
    "insurance - reinsurance": "Reinsurance",
    "insurance - diversified": "Insurance (General)",
    "insurance brokers": "Insurance (General)",
    "credit services": "Financial Svcs. (Non-bank & Insurance)",
    "mortgage finance": "Financial Svcs. (Non-bank & Insurance)",
    "financial data & stock exchanges": "Financial Svcs. (Non-bank & Insurance)",
    # Energy
    "oil & gas integrated": "Oil/Gas (Integrated)",
    # No refining row in this vintage; integrated majors are the closest cost of
    # capital and margin profile available.
    "oil & gas refining & marketing": "Oil/Gas (Integrated)",
    "oil & gas e&p": "Oil/Gas (Production and Exploration)",
    "oil & gas midstream": "Oil/Gas Distribution",
    "oil & gas equipment & services": "Oilfield Svcs/Equip.",
    "oil & gas drilling": "Oilfield Svcs/Equip.",
    "thermal coal": "Coal & Related Energy",
    "coking coal": "Coal & Related Energy",
    # Healthcare
    "biotechnology": "Drugs (Biotechnology)",
    "drug manufacturers - general": "Drugs (Pharmaceutical)",
    "drug manufacturers - specialty & generic": "Drugs (Pharmaceutical)",
    "medical devices": "Healthcare Products",
    "medical instruments & supplies": "Healthcare Products",
    "diagnostics & research": "Healthcare Products",
    "healthcare plans": "Healthcare Support Services",
    "medical distribution": "Healthcare Support Services",
    "medical care facilities": "Hospitals/Healthcare Facilities",
    # Industrials
    "aerospace & defense": "Aerospace/Defense",
    "airlines": "Air Transport",
    "airports & air services": "Air Transport",
    "railroads": "Transportation (Railroads)",
    "trucking": "Trucking",
    "integrated freight & logistics": "Transportation",
    "marine shipping": "Shipbuilding & Marine",
    "waste management": "Environmental & Waste Services",
    "pollution & treatment controls": "Environmental & Waste Services",
    "engineering & construction": "Engineering/Construction",
    "infrastructure operations": "Engineering/Construction",
    "building products & equipment": "Construction Supplies",
    "specialty industrial machinery": "Machinery",
    "farm & heavy construction machinery": "Machinery",
    "metal fabrication": "Machinery",
    "tools & accessories": "Machinery",
    "electrical equipment & parts": "Electrical Equipment",
    "industrial distribution": "Retail (Distributors)",
    "business equipment & supplies": "Office Equipment & Services",
    "specialty business services": "Business & Consumer Services",
    "consulting services": "Business & Consumer Services",
    "staffing & employment services": "Business & Consumer Services",
    "security & protection services": "Business & Consumer Services",
    "personal services": "Business & Consumer Services",
    # Equipment lessors, not lenders: the asset, not the spread, drives returns.
    "rental & leasing services": "Business & Consumer Services",
    "conglomerates": "Diversified",
    # Consumer Discretionary
    "auto manufacturers": "Auto & Truck",
    "auto parts": "Auto Parts",
    "auto & truck dealerships": "Retail (Automotive)",
    "recreational vehicles": "Recreation",
    "leisure": "Recreation",
    "apparel manufacturing": "Apparel",
    "textile manufacturing": "Apparel",
    "apparel retail": "Retail (Special Lines)",
    "luxury goods": "Retail (Special Lines)",
    "specialty retail": "Retail (Special Lines)",
    "footwear & accessories": "Shoe",
    "furnishings, fixtures & appliances": "Furn/Home Furnishings",
    "residential construction": "Homebuilding",
    "home improvement retail": "Retail (Building Supply)",
    "department stores": "Retail (General)",
    "discount stores": "Retail (General)",
    # No online-retail row in this vintage; the general retail row is the honest
    # fallback even though it understates online growth.
    "internet retail": "Retail (General)",
    "restaurants": "Restaurant/Dining",
    "lodging": "Hotel/Gaming",
    "resorts & casinos": "Hotel/Gaming",
    "gambling": "Hotel/Gaming",
    # OTAs sell hotel and travel inventory; grouped with their supply rather
    # than with Software (Internet), which is a thinner and more volatile row.
    "travel services": "Hotel/Gaming",
    "education & training services": "Education",
    # Consumer Staples
    "beverages - brewers": "Beverage (Alcoholic)",
    "beverages - wineries & distilleries": "Beverage (Alcoholic)",
    "beverages - non-alcoholic": "Beverage (Soft)",
    "packaged foods": "Food Processing",
    "confectioners": "Food Processing",
    "farm products": "Farming/Agriculture",
    "food distribution": "Food Wholesalers",
    "grocery stores": "Retail (Grocery and Food)",
    "household & personal products": "Household Products",
    "tobacco": "Tobacco",
    # Materials
    "specialty chemicals": "Chemical (Specialty)",
    "chemicals": "Chemical (Basic)",
    # Fertilizers and crop chemicals are chemistry, not farming.
    "agricultural inputs": "Chemical (Basic)",
    "building materials": "Building Materials",
    "packaging & containers": "Packaging & Container",
    "steel": "Steel",
    "aluminum": "Metals & Mining",
    "copper": "Metals & Mining",
    "other industrial metals & mining": "Metals & Mining",
    "uranium": "Metals & Mining",
    "gold": "Precious Metals",
    "silver": "Precious Metals",
    "other precious metals & mining": "Precious Metals",
    "paper & paper products": "Paper/Forest Products",
    "lumber & wood production": "Paper/Forest Products",
    # Real Estate
    "reit - residential": "R.E.I.T.",
    "reit - office": "R.E.I.T.",
    "reit - industrial": "R.E.I.T.",
    "reit - diversified": "R.E.I.T.",
    "reit - specialty": "R.E.I.T.",
    "reit - hotel & motel": "R.E.I.T.",
    "reit - healthcare facilities": "R.E.I.T.",
    "reit - mortgage": "R.E.I.T.",
    "reit - retail": "Retail (REITs)",
    "real estate - development": "Real Estate (Development)",
    "real estate - diversified": "Real Estate (General/Diversified)",
    "real estate services": "Real Estate (Operations & Services)",
    # Utilities
    "utilities - regulated electric": "Power",
    "utilities - independent power producers": "Power",
    "utilities - regulated gas": "Utility (General)",
    "utilities - diversified": "Utility (General)",
    "utilities - regulated water": "Utility (Water)",
    "utilities - renewable": "Green & Renewable Energy",
}

_INDUSTRY_TO_SECTOR = {
    industry: sector
    for sector, industries in SECTOR_TO_INDUSTRIES.items()
    for industry in industries
}


def sector_for_industry(industry: str) -> str | None:
    """The sector containing `industry`, or None when it is unmapped."""
    return _INDUSTRY_TO_SECTOR.get(industry)


def damodaran_industry_for_yahoo(yahoo_industry: str) -> str | None:
    """Yahoo's industry label mapped onto Damodaran's, or None when unmapped.

    Normalised on case and surrounding whitespace only. Yahoo's labels are
    stable enough that fuzzy matching would create more wrong answers than it
    would fix, and a wrong industry is worse than no benchmark.
    """
    return YAHOO_TO_DAMODARAN.get(yahoo_industry.strip().lower())
