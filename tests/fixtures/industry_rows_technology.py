"""Ten real rows from Damodaran's US industry-average dataset.

Transcribed from `Industry Average Beta (US)` in SpaceX2026IPOUpdated.xlsx.
Values are exact, not rounded: the resolver's averages are asserted against
them, so a rounded fixture would make an exact assertion impossible.

Two rows are deliberately included for their defects:
  Software (Internet)   reinvestment 14.1421...  (1414%)
  Information Services  reinvestment -0.2679     (negative)
"""

from packages.core_finance.industry_benchmark import IndustryRow

TECHNOLOGY_ROWS = [
    IndustryRow("Computers/Peripherals", 36, {
        "revenue_growth": 0.0671086957, "operating_margin": 0.224848747,
        "after_tax_roc": 0.4476035274, "effective_tax_rate": 0.1535453935,
        "unlevered_beta": 1.3245870397, "debt_to_capital": 0.0442031038,
        "cost_of_capital": 0.0970707313, "sales_to_capital": 3.6197887498,
        "reinvestment_rate": 0.2136889975,
    }),
    IndustryRow("Software (System & Application)", 309, {
        "revenue_growth": 0.195645, "operating_margin": 0.3298251374,
        "after_tax_roc": 0.2931842949, "effective_tax_rate": 0.1801118281,
        "unlevered_beta": 1.2481994175, "debt_to_capital": 0.0528251888,
        "cost_of_capital": 0.0934404807, "sales_to_capital": 1.5381715802,
        "reinvestment_rate": 0.7377874473,
    }),
    IndustryRow("Semiconductor Equip", 31, {
        "revenue_growth": 0.0937880769, "operating_margin": 0.2617117458,
        "after_tax_roc": 0.2840446307, "effective_tax_rate": 0.1706597835,
        "unlevered_beta": 1.3916911563, "debt_to_capital": 0.0463590191,
        "cost_of_capital": 0.0989358133, "sales_to_capital": 1.8511086723,
        "reinvestment_rate": 0.2745310217,
    }),
    IndustryRow("Semiconductor", 66, {
        "revenue_growth": 0.1117713043, "operating_margin": 0.3532779191,
        "after_tax_roc": 0.2722696684, "effective_tax_rate": 0.1579041821,
        "unlevered_beta": 1.5046492755, "debt_to_capital": 0.0252566218,
        "cost_of_capital": 0.1055061909, "sales_to_capital": 1.2066681381,
        "reinvestment_rate": 0.3528579819,
    }),
    IndustryRow("Computer Services", 64, {
        "revenue_growth": 0.2709984211, "operating_margin": 0.0740933475,
        "after_tax_roc": 0.2634856324, "effective_tax_rate": 0.2256371132,
        "unlevered_beta": 0.961700999, "debt_to_capital": 0.2006402718,
        "cost_of_capital": 0.078320702, "sales_to_capital": 5.1898906917,
        "reinvestment_rate": 0.4440778109,
    }),
    IndustryRow("Telecom. Equipment", 57, {
        "revenue_growth": 0.0327197561, "operating_margin": 0.206967645,
        "after_tax_roc": 0.2547374909, "effective_tax_rate": 0.1654122121,
        "unlevered_beta": 0.887251212, "debt_to_capital": 0.0844398133,
        "cost_of_capital": 0.0772143339, "sales_to_capital": 2.567713718,
        "reinvestment_rate": 0.4660719334,
    }),
    IndustryRow("Information Services", 15, {
        "revenue_growth": 0.0677090909, "operating_margin": 0.1188602164,
        "after_tax_roc": 0.2217430042, "effective_tax_rate": 0.2173934148,
        "unlevered_beta": 0.7563563576, "debt_to_capital": 0.249079272,
        "cost_of_capital": 0.069958157, "sales_to_capital": 2.5121429063,
        "reinvestment_rate": -0.2678902089,
    }),
    IndustryRow("Electronics (General)", 114, {
        "revenue_growth": 0.0726830263, "operating_margin": 0.1042317781,
        "after_tax_roc": 0.1791172541, "effective_tax_rate": 0.2032217979,
        "unlevered_beta": 0.9374545596, "debt_to_capital": 0.0991945884,
        "cost_of_capital": 0.078548315, "sales_to_capital": 2.3834942903,
        "reinvestment_rate": 0.7717649554,
    }),
    IndustryRow("Heathcare Information and Technology", 115, {
        "revenue_growth": 0.155735303, "operating_margin": 0.1470948559,
        "after_tax_roc": 0.1371678335, "effective_tax_rate": 0.1509666497,
        "unlevered_beta": 1.0163250326, "debt_to_capital": 0.1360045004,
        "cost_of_capital": 0.0822338862, "sales_to_capital": 1.2456990697,
        "reinvestment_rate": 0.1211666819,
    }),
    IndustryRow("Software (Internet)", 29, {
        "revenue_growth": 0.291795, "operating_margin": 0.03686142,
        "after_tax_roc": 0.034347802, "effective_tax_rate": 0.1714671615,
        "unlevered_beta": 1.5905250877, "debt_to_capital": 0.1095194174,
        "cost_of_capital": 0.1065867385, "sales_to_capital": 1.3500967702,
        "reinvestment_rate": 14.1421393679,
    }),
]
