"""Storage and orchestration for hand-authored segment build-up valuation cases.

A case is authored, not acquired. Nothing here touches the network or the
statement pipeline, which is what lets a private or pre-IPO company with no
ticker be valued at all.

The one rule this module exists to enforce: every numeric input on a segment
carries the narrative claim that justifies it. See `_validate_narratives`.
"""

from __future__ import annotations

import dataclasses
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
    "initial_growth",
    "waypoint_gap_fraction",
)

_CASE_COLUMNS = (
    "case_name", "ticker", "as_of_date", "base_year", "target_year",
    "riskfree_rate", "wacc_initial", "wacc_stable", "wacc_converge_from",
    "marginal_tax_rate", "nol_balance", "roic_stable", "terminal_growth",
    "effective_tax_rate",
    "cash", "debt", "ipo_proceeds", "shares_basic", "shares_new",
    "parent_case_id",
)

_SEGMENT_COLUMNS = (
    "name", "base_revenue", "base_margin", "tam_target", "market_share_target",
    "revenue_target", "margin_target", "sales_to_capital_early",
    "sales_to_capital_late", "ramp_start_year", "initial_growth",
    "waypoint_gap_fraction",
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

    # Minor B: `SegmentSpec.target_revenue()` gives an explicit `revenue_target`
    # precedence over `tam_target x market_share_target`, so stating both means
    # one of the two narrated numbers never enters the model. Reject the
    # combination outright rather than let a narrative silently go unused.
    if (
        segment.get("revenue_target") is not None
        and segment.get("tam_target") is not None
        and segment.get("market_share_target") is not None
    ):
        raise ValueError(
            f"segment '{name}': states tam_target, market_share_target AND "
            f"revenue_target. target_revenue() gives revenue_target precedence, "
            f"which would silently ignore the tam x share pair -- state this "
            f"segment's revenue endpoint one way or the other."
        )

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


def _specs_from_payload(payload: dict) -> tuple[CaseSpec, list[SegmentSpec]]:
    """Build engine specs from a create payload, as `load_case` would.

    Normalizing through the column lists reproduces exactly what a stored row
    yields on read -- `None` for anything unstated -- so the write-time trial
    and the later run cannot disagree about their inputs. `_to_specs` indexes
    with `case["key"]` and would raise `KeyError` on an omitted optional field,
    where `create_case` tolerates the omission via `.get()`.
    """
    normalized = {column: payload.get(column) for column in _CASE_COLUMNS}
    normalized["segments"] = [
        {column: segment.get(column) for column in _SEGMENT_COLUMNS}
        for segment in payload["segments"]
    ]
    return _to_specs(normalized)


def _required_field_names(spec_cls: type) -> tuple[str, ...]:
    """Field names on an engine dataclass that `__post_init__` uses unconditionally.

    A field qualifies here when it has no default at all, or when its default
    is a concrete value rather than `None`. `CaseSpec` and `SegmentSpec` both
    assume such a field is present -- their `__post_init__` guards compare it
    directly with no `None` check. That is true of a no-default field like
    `shares_basic` (`self.shares_basic <= 0`), and it is equally true of a
    field with a non-`None` default: `SegmentSpec.ramp_start_year` defaults to
    `1` but is still compared unconditionally (`self.ramp_start_year < 1`), so
    passing `None` reaches that comparison and raises `TypeError`, not
    `ValueError`. A `None` default, by contrast, is the dataclass's own signal
    that the engine treats the field's absence as a distinct, valid case (see
    e.g. `CaseSpec.terminal_growth`, `SegmentSpec.tam_target`), so those fields
    are deliberately left out.

    This is a heuristic over dataclass metadata, not an inspection of
    `__post_init__` itself, and it has one known blind spot: a future field
    that defaults to `None` but that some `__post_init__` or downstream engine
    path nonetheless dereferences without a null check -- the same shape of
    defect this predicate was extended to close for `ramp_start_year`,
    recurring on a field this predicate is built to treat as optional. Closing
    that class of gap for good would mean inspecting `__post_init__` itself,
    not deriving from dataclass field metadata.
    """
    return tuple(
        field.name
        for field in dataclasses.fields(spec_cls)
        if (field.default is dataclasses.MISSING or field.default is not None)
        and field.default_factory is dataclasses.MISSING  # type: ignore[misc]
    )


_REQUIRED_CASE_FIELDS = _required_field_names(CaseSpec)
_REQUIRED_SEGMENT_FIELDS = _required_field_names(SegmentSpec)


def _validate_required_fields(payload: dict) -> None:
    """Reject a missing required field before it reaches `CaseSpec`/`SegmentSpec`.

    Nothing previously built a `CaseSpec`/`SegmentSpec` from an unvalidated
    payload -- a missing required field (e.g. `shares_basic=None`) used to
    reach SQLite's `NOT NULL` constraint first, at INSERT time, and come back
    as a clean `ValueError` naming the column. `_validate_by_engine` now
    builds a trial spec earlier than that, so without this check the same
    missing field would instead hit a null-unsafe `__post_init__` comparison
    and raise `TypeError` -- a regression from a clean 422 to an unhandled
    500 for any caller that reaches `create_case` without Pydantic's own
    field validation ahead of it. This check restores the original, clean
    rejection at the new, earlier point.
    """
    missing_case = [f for f in _REQUIRED_CASE_FIELDS if payload.get(f) is None]
    if missing_case:
        raise ValueError(f"case is missing required field(s): {', '.join(missing_case)}")
    for segment in payload["segments"]:
        missing_segment = [f for f in _REQUIRED_SEGMENT_FIELDS if segment.get(f) is None]
        if missing_segment:
            name = segment.get("name") or "?"
            raise ValueError(
                f"segment '{name}' is missing required field(s): "
                f"{', '.join(missing_segment)}"
            )


def _validate_by_engine(payload: dict) -> None:
    """Reject at write time what `run_case` rejects at read time.

    First checks that every no-default `CaseSpec`/`SegmentSpec` field is
    present (`_validate_required_fields`) -- a missing one is a structural
    defect, not an economic refusal, and the engine's own dataclasses raise
    `TypeError`, not `ValueError`, for it. Only after that does it run the
    real engine itself against specs built from the payload. Any `ValueError`
    guard reached by `run_case` through this execution path is enforced at
    creation time without duplicating the guard in this layer.

    Only `ValueError` is translated. A `KeyError`, `TypeError` or anything else
    is a defect in this module or the engine, not an economic refusal, and must
    keep its own type and traceback. Do NOT widen this to `except Exception`:
    that would relabel programming and infrastructure faults as ordinary
    validation failures and bury them behind a 422.

    The engine's result is discarded. This is a gate, not a computation.
    """
    _validate_required_fields(payload)
    try:
        run_case(*_specs_from_payload(payload))
    except ValueError as exc:
        raise ValueError(f"case is not valuable: {exc}") from exc


def create_case(payload: dict) -> int:
    """Persist a case, its segments and their narratives in one transaction."""
    segments = payload.get("segments") or []
    if not segments:
        raise ValueError("a valuation case needs at least one segment")
    for segment in segments:
        _validate_narratives(segment)
    # D1: `_validate_runnable` used to run here, re-stating two cross-field rules
    # the engine already enforces (`SegmentSpec.__post_init__` for the
    # both-curves-set case, `_gap_closing_revenues` for the 10-year horizon).
    # Because it ran FIRST its wording shadowed the engine's, so editing an
    # engine message left a stale duplicate diverging with no test failure.
    _validate_by_engine(payload)

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
        effective_tax_rate=case["effective_tax_rate"],
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
            initial_growth=segment["initial_growth"],
            waypoint_gap_fraction=segment["waypoint_gap_fraction"],
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
        "marginal_roic_target_year": result.marginal_roic_target_year,
        "terminal_capital_intensity_change": result.terminal_capital_intensity_change,
        "terminal_reinvestment_rate": result.terminal_reinvestment_rate,
        "reinvestment_rate_target_year": result.reinvestment_rate_target_year,
        "explicit_reinvestment_rate_at_stable_growth": (
            result.explicit_reinvestment_rate_at_stable_growth
        ),
        "below_probable": _below_probable(case),
    }
