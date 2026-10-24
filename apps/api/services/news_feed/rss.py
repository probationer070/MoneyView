"""Google News RSS parsing, normalization and response classification.

Every Google News RSS request in the app goes through `fetch_feed`, so the
blocked/failed/ok classification lives in one place.
"""

from __future__ import annotations

import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date
from email.utils import parsedate_to_datetime
from typing import Literal
from urllib.parse import quote

Opener = Callable[[str], tuple[int, bytes]]

# Google returns these UTC times for items whose real publish time is unknown.
PLACEHOLDER_TIMES = frozenset({"07:00:00", "08:00:00"})
BLOCK_MARKER = b"automated queries"
BLOCK_STATUSES = frozenset({429, 503})


@dataclass(frozen=True)
class FeedItem:
    title: str
    url: str
    source: str
    published_date: str
    published_at: str | None
    guid: str


@dataclass(frozen=True)
class FeedResult:
    status: Literal["ok", "blocked", "failed"]
    items: list[FeedItem] = field(default_factory=list)
    detail: str = ""


def normalize_pub_date(raw: str | None) -> tuple[str, str | None]:
    if not raw:
        return ("", None)
    try:
        moment = parsedate_to_datetime(raw).astimezone(UTC)
    except (TypeError, ValueError, IndexError):
        return ("", None)
    day = moment.strftime("%Y-%m-%d")
    if moment.strftime("%H:%M:%S") in PLACEHOLDER_TIMES:
        return (day, None)
    return (day, moment.strftime("%Y-%m-%dT%H:%M:%SZ"))


def strip_source_suffix(title: str, source: str) -> str:
    suffix = " - " + source
    if source and title.endswith(suffix):
        return title[: -len(suffix)]
    return title


def parse_feed(xml: bytes) -> list[FeedItem]:
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as error:
        raise ValueError(f"not XML: {error}") from error
    channel = root.find("channel")
    if root.tag != "rss" or channel is None:
        raise ValueError("not an RSS feed with a channel")

    items: list[FeedItem] = []
    for element in channel.findall("item"):
        source_element = element.find("source")
        source = (source_element.text or "").strip() if source_element is not None else ""
        published_date, published_at = normalize_pub_date(element.findtext("pubDate"))
        items.append(
            FeedItem(
                title=strip_source_suffix((element.findtext("title") or "").strip(), source),
                url=(element.findtext("link") or "").strip(),
                source=source,
                published_date=published_date,
                published_at=published_at,
                guid=(element.findtext("guid") or "").strip(),
            )
        )
    return items


def search_url(
    query: str,
    lang: Literal["en", "ko"],
    *,
    after: date | None = None,
    before: date | None = None,
) -> str:
    text = query
    if after is not None:
        text += f" after:{after.isoformat()}"
    if before is not None:
        text += f" before:{before.isoformat()}"
    edition = "hl=en-US&gl=US&ceid=US:en" if lang == "en" else "hl=ko&gl=KR&ceid=KR:ko"
    return f"https://news.google.com/rss/search?q={quote(text, safe='')}&{edition}"


def _default_opener(url: str) -> tuple[int, bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return (response.status, response.read())
    except urllib.error.HTTPError as error:
        return (error.code, error.read())


def fetch_feed(url: str, *, opener: Opener | None = None) -> FeedResult:
    open_url = opener or _default_opener
    try:
        status, body = open_url(url)
    except AssertionError:
        raise
    except Exception as error:
        return FeedResult("failed", [], str(error))

    if status in BLOCK_STATUSES or BLOCK_MARKER in body.lower():
        return FeedResult("blocked", [], f"HTTP {status}")
    if status != 200:
        return FeedResult("failed", [], f"HTTP {status}")
    try:
        items = parse_feed(body)
    except ValueError as error:
        return FeedResult("failed", [], str(error))
    return FeedResult("ok", items, "")
