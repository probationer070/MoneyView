"""Storage and orchestration for hand-authored segment build-up valuation cases.

A case is authored, not acquired. Nothing here touches the network or the
statement pipeline, which is what lets a private or pre-IPO company with no
ticker be valued at all.

The one rule this module exists to enforce: every numeric input on a segment
carries the narrative claim that justifies it. See `_validate_narratives`.
"""

from __future__ import annotations

import sqlite3

from apps.api.services.db import get_db
from packages.core_finance.segment_valuation import (
    CaseSpec,
    SegmentSpec,
    run_case,
)

# The segment's estimated inputs: base_revenue, base_margin, the three possible
# endpoint fields (tam_target, market_share_target, revenue_target), margin_target,
# and the two sales-to-capital ratios. A non-NULL value in any of these needs a
# segment_narrative row; a narrative for a field left NULL is rejected too, since
# it is a claim about a number the model never uses.
#
# `ramp_start_year` is deliberately not in this tuple: it is a NOT NULL,
# DEFAULT 1 structural field, not an estimated input, so requiring a claim for
# it would demand a narrative even from a segment that never touches the default.
NARRATED_FIELDS: tuple[str, ...] = (
    "base_revenue",
    "base_margin",
    "tam_target",
    "market_share_target",
    "revenue_target",
    "margin_target",
    "sales_to_capital_early",
    "sales_to_capital_late",
)

_CASE_COLUMNS = (
    "case_name", "ticker", "as_of_date", "base_year", "target_year",
    "riskfree_rate", "wacc_initial", "wacc_stable", "wacc_converge_from",
    "marginal_tax_rate", "nol_balance", "roic_stable", "terminal_growth",
    "cash", "debt", "ipo_proceeds", "shares_basic", "shares_new",
    "parent_case_id",
)

_SEGMENT_COLUMNS = (
    "name", "base_revenue", "base_margin", "tam_target", "market_share_target",
    "revenue_target", "margin_target", "sales_to_capital_early",
    "sales_to_capital_late", "ramp_start_year",
)


class CaseNotFound(Exception):
    """No valuation case with the requested id."""


def _validate_narratives(segment: dict) -> None:
    """Every stated input has a claim, and every claim names a stated input.

    Both directions matter. Without the first, a number can enter the model with
    no stated reason -- which is the whole discipline this feature encodes. Without
    the second, a claim survives the removal of the input it justified and quietly
    misdescribes the case.
    """
    name = segment.get("name", "?")
    stated = {f for f in NARRATED_FIELDS if segment.get(f) is not None}
    claimed = {n["input_field"] for n in segment.get("narratives", [])}

    for field in sorted(stated - claimed):
        raise ValueError(
            f"segment '{name}': input '{field}' has no narrative claim. Every "
            f"number in a valuation case must state why it holds that value."
        )
    for field in sorted(claimed - stated):
        raise ValueError(
            f"segment '{name}': narrative for '{field}', which this segment does "
            f"not set. A claim about an unused input cannot be checked."
        )


def create_case(payload: dict) -> int:
    """Persist a case, its segments and their narratives in one transaction."""
    segments = payload.get("segments") or []
    if not segments:
        raise ValueError("a valuation case needs at least one segment")
    for segment in segments:
        _validate_narratives(segment)

    with get_db() as conn:
        try:
            cursor = conn.execute(
                f"INSERT INTO valuation_case ({', '.join(_CASE_COLUMNS)}) "
                f"VALUES ({', '.join('?' * len(_CASE_COLUMNS))})",
                tuple(payload.get(column) for column in _CASE_COLUMNS),
            )
        except sqlite3.IntegrityError as exc:
            message = str(exc)
            # Only the case_name uniqueness violation gets the "already exists"
            # message. Every other IntegrityError on this row (a dangling
            # parent_case_id, a NULL in a NOT NULL column, ...) has nothing to do
            # with the name, and mislabeling it sends the author chasing the
            # wrong fix.
            if message.startswith("UNIQUE constraint failed") and "case_name" in message:
                raise ValueError(
                    f"case name '{payload.get('case_name')}' already exists"
                ) from exc
            raise ValueError(f"could not create case: {message}") from exc
        case_id = int(cursor.lastrowid)

        for segment in segments:
            try:
                segment_cursor = conn.execute(
                    f"INSERT INTO segment (case_id, {', '.join(_SEGMENT_COLUMNS)}) "
                    f"VALUES (?, {', '.join('?' * len(_SEGMENT_COLUMNS))})",
                    (case_id, *(segment.get(column) for column in _SEGMENT_COLUMNS)),
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError(
                    f"segment '{segment.get('name')}' could not be created: {exc}"
                ) from exc
            segment_id = int(segment_cursor.lastrowid)
            for narrative in segment.get("narratives", []):
                try:
                    conn.execute(
                        "INSERT INTO segment_narrative (segment_id, input_field, claim,"
                        " evidence_source, confidence, three_p) VALUES (?, ?, ?, ?, ?, ?)",
                        (
                            segment_id,
                            narrative["input_field"],
                            narrative["claim"],
                            narrative.get("evidence_source"),
                            narrative["confidence"],
                            narrative["three_p"],
                        ),
                    )
                except sqlite3.IntegrityError as exc:
                    raise ValueError(
                        f"segment '{segment.get('name')}': could not save narrative for "
                        f"'{narrative.get('input_field')}' "
                        f"(confidence={narrative.get('confidence')!r}, "
                        f"three_p={narrative.get('three_p')!r}): {exc}"
                    ) from exc
    return case_id


def list_cases() -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, case_name, ticker, as_of_date, base_year, target_year,"
            " parent_case_id FROM valuation_case ORDER BY id"
        ).fetchall()
    return [dict(row) for row in rows]


def load_case(case_id: int) -> dict:
    with get_db() as conn:
        case_row = conn.execute(
            "SELECT * FROM valuation_case WHERE id = ?", (case_id,)
        ).fetchone()
        if case_row is None:
            raise CaseNotFound(f"no valuation case with id {case_id}")

        case = dict(case_row)
        case["segments"] = []
        for segment_row in conn.execute(
            "SELECT * FROM segment WHERE case_id = ? ORDER BY id", (case_id,)
        ).fetchall():
            segment = dict(segment_row)
            segment["narratives"] = [
                dict(row)
                for row in conn.execute(
                    "SELECT input_field, claim, evidence_source, confidence, three_p"
                    " FROM segment_narrative WHERE segment_id = ? ORDER BY input_field",
                    (segment["id"],),
                ).fetchall()
            ]
            case["segments"].append(segment)
    return case


def _to_specs(case: dict) -> tuple[CaseSpec, list[SegmentSpec]]:
    spec = CaseSpec(
        base_year=case["base_year"],
        target_year=case["target_year"],
        riskfree_rate=case["riskfree_rate"],
        wacc_initial=case["wacc_initial"],
        wacc_stable=case["wacc_stable"],
        wacc_converge_from=case["wacc_converge_from"],
        marginal_tax_rate=case["marginal_tax_rate"],
        nol_balance=case["nol_balance"],
        roic_stable=case["roic_stable"],
        terminal_growth=case["terminal_growth"],
        cash=case["cash"],
        debt=case["debt"],
        ipo_proceeds=case["ipo_proceeds"],
        shares_basic=case["shares_basic"],
        shares_new=case["shares_new"],
    )
    segments = [
        SegmentSpec(
            name=segment["name"],
            base_revenue=segment["base_revenue"],
            base_margin=segment["base_margin"],
            margin_target=segment["margin_target"],
            sales_to_capital_early=segment["sales_to_capital_early"],
            sales_to_capital_late=segment["sales_to_capital_late"],
            tam_target=segment["tam_target"],
            market_share_target=segment["market_share_target"],
            revenue_target=segment["revenue_target"],
            ramp_start_year=segment["ramp_start_year"],
        )
        for segment in case["segments"]
    ]
    return spec, segments


def _below_probable(case: dict) -> list[dict]:
    """Inputs the author did not rate Probable.

    Reported rather than refused. The author assigns three_p themselves, so a
    hard gate would only reject numbers someone had already flagged as weak --
    it would catch nothing an honest author had not already disclosed.
    """
    return [
        {
            "segment": segment["name"],
            "input_field": narrative["input_field"],
            "three_p": narrative["three_p"],
        }
        for segment in case["segments"]
        for narrative in segment["narratives"]
        if narrative["three_p"] != "probable"
    ]


def run_stored_case(case_id: int) -> dict:
    """Value a stored case. Raises ValueError on any model-invalid input."""
    case = load_case(case_id)
    spec, segments = _to_specs(case)
    result = run_case(spec, segments)

    return {
        "case_id": case_id,
        "case_name": case["case_name"],
        "base_year": case["base_year"],
        "target_year": case["target_year"],
        "segments": [
            {
                "name": segment.name,
                "revenue": segment.revenue,
                "margin": segment.margin,
                "ebit": segment.ebit,
                "reinvestment": segment.reinvestment,
            }
            for segment in result.segments
        ],
        "revenue": result.revenue,
        "ebit": result.ebit,
        "tax": result.tax,
        "reinvestment": result.reinvestment,
        "fcff": result.fcff,
        "wacc": result.wacc,
        "discount_factor": result.discount_factor,
        "pv_explicit": result.pv_explicit,
        "terminal_value": result.terminal_value,
        "pv_terminal": result.pv_terminal,
        "terminal_value_share_pct": result.terminal_value_share_pct,
        "terminal_spread": result.terminal_spread,
        "enterprise_value": result.enterprise_value,
        "equity_bridge": {
            "enterprise_value": result.enterprise_value,
            "cash": spec.cash,
            "ipo_proceeds": spec.ipo_proceeds,
            "debt": spec.debt,
            "equity_value": result.equity_value,
        },
        "equity_value": result.equity_value,
        "value_per_share_basic": result.value_per_share_basic,
        "value_per_share_diluted": result.value_per_share_diluted,
        "base_revenue_total": result.base_revenue_total,
        "base_ebit_total": result.base_ebit_total,
        "below_probable": _below_probable(case),
    }
