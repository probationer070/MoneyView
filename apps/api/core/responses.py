"""The app's default JSON response class.

JSON has no NaN/Inf. Starlette's `JSONResponse` renders with
`json.dumps(..., allow_nan=False)`, so a single non-finite float anywhere in a response
body raises `ValueError: Out of range float values are not JSON compliant` and the whole
request 500s -- see ERROR-LOG.md (2026-07-26), where one index's live data took down the
entire `/market/indices` card list.

Routes that declare `response_model=` are already safe by accident: FastAPI serializes
those through pydantic's own JSON writer, which emits `null` for non-finite floats and
never reaches `json.dumps`. Routes without one fall back to `jsonable_encoder` plus
Starlette's renderer and are exposed. Making this the app-wide default response class
removes that distinction rather than leaving it to whether a route happens to declare a
model.

Non-finite becomes `null` -- "no number here" -- matching what the pydantic path already
produces, so both kinds of route agree. It is not 0.0: `guideline/sop/finance-logic.md`
prohibits standing a real figure in for an absent one, and a NaN delta rendered as 0.0%
would read as "unchanged".

This is the web boundary. The compute boundary keeps its own serializer
(`apps/api/compute/serialization.py`), which maps non-finite floats to a sentinel object
instead, because that value has to survive a round trip back into a pydantic model where
`null` would be rejected for a float field. Here the reader is a TypeScript client, and a
sentinel object where a number belongs would break its types.
"""
from __future__ import annotations

import json
import math
from typing import Any

from fastapi.responses import JSONResponse


def null_nonfinite(value: Any) -> Any:
    """Replace every non-finite float in a jsonable structure with None."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: null_nonfinite(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [null_nonfinite(item) for item in value]
    return value


class NonFiniteSafeJSONResponse(JSONResponse):
    """JSONResponse that renders non-finite floats as null instead of raising."""

    def render(self, content: Any) -> bytes:
        # allow_nan stays False: every non-finite value was just replaced, so if one still
        # reaches json.dumps that is a gap in the walk above and should raise loudly rather
        # than emit a bare `NaN` token no JSON parser is required to accept.
        return json.dumps(
            null_nonfinite(content),
            ensure_ascii=False,
            allow_nan=False,
            indent=None,
            separators=(",", ":"),
        ).encode("utf-8")
