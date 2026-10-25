"""Errors shared between the acquisition runner and the provider gates."""
from __future__ import annotations


class ProviderRefused(Exception):
    """A provider gate refused to send the request, so nothing was asked.

    The runner records no check for it (a check means "asked") and re-raises it, so the caller
    can stop its batch.
    """
