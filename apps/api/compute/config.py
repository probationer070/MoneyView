# apps/api/compute/config.py
"""Compute-seam settings. Matches the repo's os.getenv convention (no BaseSettings)."""
from __future__ import annotations

import os


def compute_client_mode() -> str:
    return os.getenv("MONEYVIEW_COMPUTE_CLIENT_MODE", "inprocess").strip().lower()


def compute_service_base_url() -> str:
    return os.getenv("MONEYVIEW_COMPUTE_SERVICE_BASE_URL", "http://127.0.0.1:8600").strip()


def compute_connect_timeout() -> float:
    return float(os.getenv("MONEYVIEW_COMPUTE_CONNECT_TIMEOUT", "2.0"))


def compute_timeout() -> float:
    return float(os.getenv("MONEYVIEW_COMPUTE_TIMEOUT", "30.0"))


def compute_stream_read_timeout() -> float:
    return float(os.getenv("MONEYVIEW_COMPUTE_STREAM_READ_TIMEOUT", "300.0"))
