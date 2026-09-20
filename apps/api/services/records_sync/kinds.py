"""What each synced record kind is made of (spec §1, §3).

A kind names one table, the column that identifies a record across PCs, the columns that travel in
the payload, and — for a valuation case — the child tables that ride along inside it. Nothing here
touches SQLite; store.py reads this to build and apply records.
"""

from __future__ import annotations

from dataclasses import dataclass, field

KIND_VALUATION_CASE = "valuation_case"
KIND_DECISION = "investment_decision"
KIND_USER_EVENT = "user_event"
KIND_CATEGORY = "event_category"
KIND_VISIBILITY = "event_category_visibility"
KIND_PREFERENCES = "portfolio_preferences"


@dataclass(frozen=True)
class ChildSpec:
    """A table carried inside its parent's payload and rebuilt under local ids on import."""

    key: str                 # the payload key holding the list
    table: str
    parent_column: str       # the column pointing at the parent's local id
    columns: tuple[str, ...]
    children: tuple["ChildSpec", ...] = ()


@dataclass(frozen=True)
class Kind:
    name: str
    table: str
    uid_column: str          # the column holding the record's cross-PC identity
    columns: tuple[str, ...]  # payload columns, excluding local ids and the uid
    generates_uid: bool = False   # True: a new row needs a generated sync_uid
    natural_key: str | None = None  # a UNIQUE column that two PCs can collide on (spec §5)
    children: tuple[ChildSpec, ...] = ()
    singleton_uid: str | None = None


_SEGMENT_NARRATIVE = ChildSpec(
    key="narratives",
    table="segment_narrative",
    parent_column="segment_id",
    columns=("input_field", "claim", "evidence_source", "confidence", "three_p"),
)

_SEGMENT = ChildSpec(
    key="segments",
    table="segment",
    parent_column="case_id",
    columns=("name", "base_revenue", "base_margin", "tam_target", "market_share_target",
             "revenue_target", "margin_target", "sales_to_capital_early", "sales_to_capital_late",
             "ramp_start_year", "initial_growth", "waypoint_gap_fraction"),
    children=(_SEGMENT_NARRATIVE,),
)

KINDS: dict[str, Kind] = {
    KIND_VALUATION_CASE: Kind(
        name=KIND_VALUATION_CASE,
        table="valuation_case",
        uid_column="sync_uid",
        # parent_case_id points at a LOCAL id, so it never travels: a fork's parent link is local
        # provenance, and a peer's id would name a different case here.
        columns=("case_name", "ticker", "as_of_date", "base_year", "target_year", "riskfree_rate",
                 "wacc_initial", "wacc_stable", "wacc_converge_from", "marginal_tax_rate",
                 "nol_balance", "roic_stable", "terminal_growth", "effective_tax_rate", "cash",
                 "debt", "ipo_proceeds", "shares_basic", "shares_new"),
        generates_uid=True,
        natural_key="case_name",
        children=(_SEGMENT,),
    ),
    KIND_DECISION: Kind(
        name=KIND_DECISION,
        table="investment_decision",
        uid_column="sync_uid",
        columns=("ticker", "decided_at", "action", "memo", "price_at_decision", "dcf_value",
                 "dcf_implied_return", "roic", "wacc", "risk_free_rate", "equity_risk_premium",
                 "metric_schema_version", "figures_source", "figures_unavailable_reason"),
        generates_uid=True,
    ),
    KIND_USER_EVENT: Kind(
        name=KIND_USER_EVENT,
        table="user_event",
        uid_column="sync_uid",
        columns=("label", "category", "start_date", "end_date", "source", "note", "created_at"),
        generates_uid=True,
    ),
    KIND_CATEGORY: Kind(
        name=KIND_CATEGORY,
        table="event_category",
        uid_column="id",
        columns=("id", "kind", "label", "color", "created_at"),
    ),
    KIND_VISIBILITY: Kind(
        name=KIND_VISIBILITY,
        table="event_category_visibility",
        uid_column="category_id",
        columns=("category_id", "visible"),
    ),
    KIND_PREFERENCES: Kind(
        name=KIND_PREFERENCES,
        table="portfolio_preferences",
        uid_column="singleton_id",
        columns=("total_investment_amount", "transaction_fee_rate", "updated_at"),
        singleton_uid="portfolio_preferences",
    ),
}
