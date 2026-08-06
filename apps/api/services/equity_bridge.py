"""Read the enterprise-to-equity bridge inputs out of locally stored statements.

This module is the only place that knows Yahoo's balance-sheet label names for the
bridge, and the only place that converts units. It acquires nothing: metric
computation must never touch the network, so a ticker whose statements have not been
acquired yields three `missing` inputs rather than a fetch.

Everything it emits is in billions -- of currency for the two money terms, of shares
for the share count -- so `equity_value / diluted_shares_outstanding` yields dollars
per share with no further scaling. Scaling happens here, at read time, rather than in
the store: stored values stay verbatim as the provider reported them, no migration is
needed, and the conversion lives in one layer.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from apps.api.models.schema_parts.corporate import BridgeInputMeta, BridgeSource
from apps.api.services.corporate_statement_metrics import get_yahoo_statement_bundle
from packages.core_finance.dcf import calculate_net_debt

_BILLION = 1_000_000_000.0

_TOTAL_DEBT_LABELS = ("Total Debt",)
_NET_DEBT_LABELS = ("Net Debt",)
_CASH_LABELS = (
    "Cash Cash Equivalents And Short Term Investments",
    "Cash And Cash Equivalents",
)
_INVESTMENT_LABELS = ("Investments And Advances", "Long Term Equity Investment")
_DILUTED_SHARE_LABELS = ("Diluted Average Shares",)

_MISSING = BridgeInputMeta(value=None, source=BridgeSource.UNAVAILABLE, quality="missing")


@dataclass(frozen=True)
class EquityBridge:
    net_debt: BridgeInputMeta
    non_operating_assets: BridgeInputMeta
    diluted_shares_outstanding: BridgeInputMeta


def _by_period(frames: list[object], labels: tuple[str, ...]) -> dict[pd.Timestamp, float]:
    """Every reported value for the first matching label, keyed by period end.

    The store pads absent (line_item, period) cells with NaN, so one label can stop
    reporting part way along a frame's columns while another keeps going. Those cells
    are dropped here, which is what lets a caller ask which periods actually carry a
    figure rather than only which period is newest overall. An earlier frame wins a
    period the later ones also report, matching the annual-before-quarterly order the
    callers pass.
    """
    values: dict[pd.Timestamp, float] = {}
    for frame in frames:
        if frame is None or not isinstance(frame, pd.DataFrame) or frame.empty:
            continue
        for label in labels:
            if label not in frame.index:
                continue
            for period, raw in frame.loc[label].items():
                if raw is None or pd.isna(raw):
                    continue
                values.setdefault(period, float(raw))
            break  # first matching label wins within a frame
    return values


def _latest(frames: list[object], labels: tuple[str, ...]) -> tuple[float | None, str | None]:
    """The newest reported value for the first matching label, across every frame.

    A balance sheet is a point-in-time snapshot, so the most recent period wins -- a
    quarterly figure beats an older annual one. Returns the value and its period end.
    """
    values = _by_period(frames, labels)
    if not values:
        return None, None
    period = max(values)
    return values[period], str(period.date())


def _scaled(value: float | None) -> float | None:
    return None if value is None else value / _BILLION


def _net_debt_input(bundle: dict) -> BridgeInputMeta:
    balances = [bundle.get("balance"), bundle.get("quarterly_balance")]
    debt_by_period = _by_period(balances, _TOTAL_DEBT_LABELS)
    cash_by_period = _by_period(balances, _CASH_LABELS)

    # Both terms must come off the same balance sheet. Resolving each independently --
    # newest debt against newest cash -- pairs figures from different dates whenever one
    # line stops reporting before the other, which the store's NaN padding makes ordinary.
    # June debt minus September cash understates net debt, reports quality "ok", and puts
    # only one of the two dates in as_of, so nothing downstream can see the mismatch.
    co_dated = debt_by_period.keys() & cash_by_period.keys()
    if co_dated:
        period = max(co_dated)
        return BridgeInputMeta(
            value=_scaled(calculate_net_debt(debt_by_period[period], cash_by_period[period])),
            source=BridgeSource.TOTAL_DEBT_LESS_CASH,
            quality="ok",
            as_of=str(period.date()),
        )

    # Falling back to the reported Net Debt line means relying on a definition we cannot
    # see, which varies by sector. Usable, but it is a fallback and must say so.
    reported, reported_period = _latest(balances, _NET_DEBT_LABELS)
    if reported is not None:
        return BridgeInputMeta(
            value=_scaled(reported),
            source=BridgeSource.REPORTED_NET_DEBT,
            quality="estimated",
            as_of=reported_period,
        )
    return _MISSING


def _non_operating_assets_input(bundle: dict) -> BridgeInputMeta:
    value, period = _latest(
        [bundle.get("balance"), bundle.get("quarterly_balance")], _INVESTMENT_LABELS
    )
    if value is None:
        # Estimated, not missing: omitting this term understates equity value by a bounded
        # amount that is immaterial for most issuers, and refusing to value a company
        # because Yahoo reported no investments line would make the bridge useless. The
        # caller sums it as 0.0 and the payload records that it was absent.
        return BridgeInputMeta(
            value=None, source=BridgeSource.UNAVAILABLE, quality="estimated"
        )
    return BridgeInputMeta(
        value=_scaled(value),
        source=BridgeSource.INVESTMENTS_ADVANCES,
        quality="ok",
        as_of=period,
    )


def _diluted_shares_input(bundle: dict) -> BridgeInputMeta:
    value, period = _latest(
        [bundle.get("income"), bundle.get("quarterly_income")], _DILUTED_SHARE_LABELS
    )
    if value is not None and value > 0:
        return BridgeInputMeta(
            value=_scaled(value),
            source=BridgeSource.DILUTED_AVERAGE_SHARES,
            quality="ok",
            as_of=period,
        )

    info = bundle.get("info") or {}
    raw = info.get("sharesOutstanding")
    if raw is None:
        return _MISSING
    try:
        shares = float(raw)
    except (TypeError, ValueError):
        return _MISSING
    if shares <= 0:
        return _MISSING
    # sharesOutstanding is a basic count and the field promises diluted.
    return BridgeInputMeta(
        value=_scaled(shares),
        source=BridgeSource.SHARES_OUTSTANDING,
        quality="estimated",
    )


def load_equity_bridge(ticker: str, *, bundle_loader=get_yahoo_statement_bundle) -> EquityBridge:
    """Build the three bridge inputs for one ticker from the local store.

    `bundle_loader` is injected so tests run against a synthetic bundle with no
    database and no network, matching how `yahoo_statement_metrics` is tested.

    Writes nothing, opens no socket, holds no module state. A ticker with nothing
    stored yields three `missing` inputs -- never None for the bridge itself, so
    callers never branch on two levels of absence.
    """
    bundle = bundle_loader(ticker.upper(), "equity_bridge")
    if bundle is None:
        return EquityBridge(_MISSING, _MISSING, _MISSING)
    return EquityBridge(
        net_debt=_net_debt_input(bundle),
        non_operating_assets=_non_operating_assets_input(bundle),
        diluted_shares_outstanding=_diluted_shares_input(bundle),
    )
