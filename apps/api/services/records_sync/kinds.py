"""What each synced record kind is made of (spec §1, §3).

A kind names one table, the column that identifies a record across PCs, the columns that travel in
the payload, and — for a valuation case — the child tables that ride along inside it. Nothing here
touches SQLite; store.py reads this to build and apply records.
"""

from __future__ import annotations

from dataclasses import dataclass

KIND_VALUATION_CASE = "valuation_case"
KIND_DECISION = "investment_decision"
KIND_USER_EVENT = "user_event"
KIND_CATEGORY = "event_category"
KIND_VISIBILITY = "event_category_visibility"
KIND_PREFERENCES = "portfolio_preferences"

# The payload key carrying a fork's lineage: the sync_uid of the case its parent_case_id points at.
PARENT_UID_KEY = "parent_uid"


@dataclass(frozen=True)
class ChildSpec:
    """A table carried inside its parent's payload and rebuilt under local ids on import."""

    key: str                 # the payload key holding the list
    table: str
    parent_column: str       # the column pointing at the parent's local id
    columns: tuple[str, ...]
    children: tuple["ChildSpec", ...] = ()
    not_null: tuple[str, ...] = ()   # payload columns the local schema declares NOT NULL
    # (column, allowed values) for every payload column the local schema CHECKs against a set
    domains: tuple[tuple[str, tuple], ...] = ()


@dataclass(frozen=True)
class Kind:
    name: str
    table: str
    uid_column: str          # the LOCAL column used to locate the row (see singleton_uid below)
    # payload columns, excluding local ids. A kind whose identity is natural -- generates_uid is
    # False and it is not a singleton -- carries its own identity column here, because that value
    # must be written on insert. A kind with generates_uid=True does not: sync_uid is generated,
    # not payload.
    columns: tuple[str, ...]
    generates_uid: bool = False   # True: a new row needs a generated sync_uid
    natural_key: str | None = None  # a UNIQUE column that two PCs can collide on (spec §5)
    children: tuple[ChildSpec, ...] = ()
    # When set, this is the record's cross-PC identity INSTEAD of uid_column, and the table holds
    # exactly one row: found locally by uid_column (e.g. "singleton_id = 1"), identified across
    # PCs by this fixed string.
    singleton_uid: str | None = None
    not_null: tuple[str, ...] = ()   # payload columns the local schema declares NOT NULL
    # (column, allowed values) for every payload column the local schema CHECKs against a set
    domains: tuple[tuple[str, tuple], ...] = ()
    # A LOCAL column pointing at another row of this same table (a fork's parent). It never
    # travels; its target's uid does, under PARENT_UID_KEY, and is resolved back to a local id.
    lineage_column: str | None = None


def payload_columns(kind: Kind) -> tuple[str, ...]:
    """Every key of a kind's payload row (a case's "case" object): its columns, plus
    PARENT_UID_KEY when the kind has a lineage column."""
    return kind.columns + ((PARENT_UID_KEY,) if kind.lineage_column else ())


_SEGMENT_NARRATIVE = ChildSpec(
    key="narratives",
    table="segment_narrative",
    parent_column="segment_id",
    columns=("input_field", "claim", "evidence_source", "confidence", "three_p"),
    not_null=("input_field", "claim", "confidence", "three_p"),
    domains=(("confidence", ("confirmed", "derived", "assumed")),
             ("three_p", ("possible", "plausible", "probable"))),
)

_SEGMENT = ChildSpec(
    key="segments",
    table="segment",
    parent_column="case_id",
    columns=("name", "base_revenue", "base_margin", "tam_target", "market_share_target",
             "revenue_target", "margin_target", "sales_to_capital_early", "sales_to_capital_late",
             "ramp_start_year", "initial_growth", "waypoint_gap_fraction"),
    children=(_SEGMENT_NARRATIVE,),
    not_null=("name", "base_revenue", "base_margin", "margin_target", "sales_to_capital_early",
              "sales_to_capital_late", "ramp_start_year"),
)

KINDS: dict[str, Kind] = {
    KIND_VALUATION_CASE: Kind(
        name=KIND_VALUATION_CASE,
        table="valuation_case",
        uid_column="sync_uid",
        # parent_case_id points at a LOCAL id, so it never travels: a peer's id would name a
        # different case here. The parent's sync_uid travels instead (lineage_column below).
        columns=("case_name", "ticker", "as_of_date", "base_year", "target_year", "riskfree_rate",
                 "wacc_initial", "wacc_stable", "wacc_converge_from", "marginal_tax_rate",
                 "nol_balance", "roic_stable", "terminal_growth", "effective_tax_rate", "cash",
                 "debt", "ipo_proceeds", "shares_basic", "shares_new"),
        generates_uid=True,
        natural_key="case_name",
        children=(_SEGMENT,),
        not_null=("case_name", "as_of_date", "base_year", "target_year", "riskfree_rate",
                  "wacc_initial", "wacc_stable", "wacc_converge_from", "marginal_tax_rate",
                  "nol_balance", "roic_stable", "cash", "debt", "ipo_proceeds", "shares_basic",
                  "shares_new"),
        lineage_column="parent_case_id",
    ),
    KIND_DECISION: Kind(
        name=KIND_DECISION,
        table="investment_decision",
        uid_column="sync_uid",
        columns=("ticker", "decided_at", "action", "memo", "price_at_decision", "dcf_value",
                 "dcf_implied_return", "roic", "wacc", "risk_free_rate", "equity_risk_premium",
                 "metric_schema_version", "figures_source", "figures_unavailable_reason"),
        generates_uid=True,
        not_null=("ticker", "decided_at", "action", "memo", "figures_source"),
    ),
    KIND_USER_EVENT: Kind(
        name=KIND_USER_EVENT,
        table="user_event",
        uid_column="sync_uid",
        columns=("label", "category", "start_date", "end_date", "source", "note", "created_at"),
        generates_uid=True,
        not_null=("label", "category", "start_date", "note", "created_at"),
    ),
    KIND_CATEGORY: Kind(
        name=KIND_CATEGORY,
        table="event_category",
        uid_column="id",
        columns=("id", "kind", "label", "color", "created_at"),
        not_null=("kind", "created_at"),
        domains=(("kind", ("override", "user")),),
    ),
    KIND_VISIBILITY: Kind(
        name=KIND_VISIBILITY,
        table="event_category_visibility",
        uid_column="category_id",
        columns=("category_id", "visible"),
        not_null=("visible",),
        domains=(("visible", (0, 1)),),
    ),
    KIND_PREFERENCES: Kind(
        name=KIND_PREFERENCES,
        table="portfolio_preferences",
        # The row is found locally by singleton_id = 1; it is identified across PCs by
        # singleton_uid below, not by uid_column.
        uid_column="singleton_id",
        columns=("total_investment_amount", "transaction_fee_rate", "updated_at"),
        singleton_uid="portfolio_preferences",
        not_null=("total_investment_amount", "transaction_fee_rate", "updated_at"),
    ),
}
