"""The stable code of an engine refusal, for grouping.

`/fork` passes the engine's refusal through VERBATIM, because the engine owns that
wording. Grouping is different: `/simulate` counts refusals into buckets, and a client
keying a histogram off "terminal spread is not positive: wacc 3.0000% must exceed growth
3.0000%" breaks the moment anyone reformats a percentage. So a group carries a stable code
to branch on AND the engine's verbatim message to read.

The code comes from the raise site itself (`core_finance.refusals.EngineRefusal`). It used
to be recovered by matching substrings of the message against a table, so a reworded
message could land in the wrong group with every test passing. That table is gone.
"""
from __future__ import annotations

from packages.core_finance.refusals import EngineRefusal


def classify(exc: BaseException) -> str:
    """The refusal's own code, or `other` for any error the engine did not code.

    `other` is deliberately not a guess: the message is still reported verbatim, and it
    means a raise site outside `EngineRefusal`.
    """
    return exc.code if isinstance(exc, EngineRefusal) else "other"
