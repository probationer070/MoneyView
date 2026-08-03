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


def _latest(frames: list[object], labels: tuple[str, ...]) -> tuple[float | None, str | None]:
    """The newest reported value for the first matching label, across every frame.

    A balance sheet is a point-in-time snapshot, so the most recent period wins -- a
    quarterly figure beats an older annual one. Returns the value and its period end.
    """
    best_value: float | None = None
    best_period: pd.Timestamp | None = None
    for frame in frames:
        if frame is None or not isinstance(frame, pd.DataFrame) or frame.empty:
            continue
        for label in labels:
            if label not in frame.index:
                continue
            series = frame.loc[label]
            for period, raw in series.items():
                if raw is None or pd.isna(raw):
                    continue
                if best_period is None or period > best_period:
                    best_period = period
                    best_value = float(raw)
            break  # first matching label wins within a frame
    if best_value is None or best_period is None:
        return None, None
    return best_value, str(best_period.date())


def _scaled(value: float | None) -> float | None:
    return None if value is None else value / _BILLION


def _net_debt_input(bundle: dict) -> BridgeInputMeta:
    balances = [bundle.get("balance"), bundle.get("quarterly_balance")]
    total_debt, debt_period = _latest(balances, _TOTAL_DEBT_LABELS)
    cash, cash_period = _latest(balances, _CASH_LABELS)

    net_debt = calculate_net_debt(total_debt, cash)
    if net_debt is not None:
        return BridgeInputMeta(
            value=_scaled(net_debt),
            source=BridgeSource.TOTAL_DEBT_LESS_CASH,
            quality="ok",
            as_of=debt_period or cash_period,
        )

    # Falling back to the reported Net Debt line means relying on a definition we cannot
    # see, which varies by sector. Usable, but it is a fallback and must say so.
    reported, reported_period = _latest(balances, _NET_DEBT_LABELS)
    if reported is not None:
        return BridgeInputMeta(
            value=_scaled(reported),
            source=BridgeSource.NET_DEBT_PLUS_CASH,
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
