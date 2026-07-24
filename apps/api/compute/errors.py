# apps/api/compute/errors.py
from __future__ import annotations


class ComputeError(Exception):
    """Uniform error raised by every ComputeClient implementation.

    Both the in-process and HTTP clients raise this so the BFF route handles one
    error type regardless of transport. status_code maps to the browser-facing
    HTTP status; detail is the human-readable message.
    """

    def __init__(self, status_code: int, detail: str):
        super().__init__(f"[{status_code}] {detail}")
        self.status_code = status_code
        self.detail = detail
