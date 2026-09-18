"""Peer sync files: one per PC, read defensively and written atomically (spec §1).

Only names fully matching `watchlist.<pc_id>.json` count. Temp files and cloud conflict copies that
add spaces or brackets never match. A copy that does match, e.g. `watchlist.X-DESKTOP.json`, is caught
because the pc_id inside differs from the name. An unreadable file is skipped and reported, never
read as empty. This PC's own file is output only.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

from apps.api.services.watchlist_sync.model import TS_PATTERN, SyncRow, SyncState, Tombstone

FORMAT_VERSION = 1
SYNC_SUBDIR = "MoneyView"
_PEER_NAME = re.compile(r"watchlist\.([A-Za-z0-9-]+)\.json")
_PC_ID = re.compile(r"[A-Za-z0-9-]+")


class SyncFolderUnavailable(OSError):
    """The configured sync root does not exist or is not a folder."""


@dataclass(frozen=True)
class PeerFile:
    pc_id: str
    written_at: str
    state: SyncState


@dataclass(frozen=True)
class SkippedFile:
    name: str
    reason: str


def own_file_path(root: Path, pc_id: str) -> Path:
    return root / SYNC_SUBDIR / f"watchlist.{pc_id}.json"


def _require_root(root: Path) -> Path:
    if not root.is_dir():
        raise SyncFolderUnavailable(f"sync folder {root} does not exist or is not a folder")
    return root / SYNC_SUBDIR


def _ts(value, what: str) -> str:
    if not isinstance(value, str) or not TS_PATTERN.fullmatch(value):
        raise ValueError(f"{what}={value!r} is not a UTC millisecond timestamp")
    return value


def _pc(value, what: str) -> str:
    if not isinstance(value, str) or not _PC_ID.fullmatch(value):
        raise ValueError(f"{what}={value!r} is not a pc_id")
    return value


def _parse(payload: dict) -> PeerFile:
    if not isinstance(payload, dict):
        raise ValueError("the file is not a JSON object")
    if payload.get("format_version") != FORMAT_VERSION:
        raise ValueError(f"unsupported format_version {payload.get('format_version')!r}")
    rows: dict[str, SyncRow] = {}
    for raw in payload["watchlist"]:
        ticker = raw["ticker"]
        if not isinstance(ticker, str) or not ticker.strip() or ticker != ticker.strip().upper():
            raise ValueError(f"invalid ticker {ticker!r}")
        if ticker in rows:
            raise ValueError(f"duplicate ticker {ticker}")
        weight = raw["weight"]
        if isinstance(weight, bool) or not isinstance(weight, (int, float)) or not 0.0 <= float(weight) <= 1.0:
            raise ValueError(f"{ticker}: weight {weight!r} is not a number in [0, 1]")
        for text in ("name", "sector", "group_name"):
            if not isinstance(raw[text], str):
                raise ValueError(f"{ticker}: {text} is not text")
        rows[ticker] = SyncRow(
            ticker=ticker, name=raw["name"], sector=raw["sector"], group_name=raw["group_name"],
            weight=float(weight),
            updated_at=_ts(raw["updated_at"], f"{ticker} updated_at"),
            updated_by=_pc(raw["updated_by"], f"{ticker} updated_by"),
        )
    removed: dict[str, Tombstone] = {}
    for raw in payload["removed"]:
        ticker = raw["ticker"]
        if not isinstance(ticker, str) or not ticker.strip() or ticker in removed:
            raise ValueError(f"invalid or duplicate removed ticker {ticker!r}")
        removed[ticker] = Tombstone(
            ticker=ticker,
            removed_at=_ts(raw["removed_at"], f"{ticker} removed_at"),
            removed_by=_pc(raw["removed_by"], f"{ticker} removed_by"),
        )
    return PeerFile(
        pc_id=_pc(payload["pc_id"], "pc_id"),
        written_at=_ts(payload["written_at"], "written_at"),
        state=SyncState(rows=rows, removed=removed),
    )


def read_peer_files(root: Path, own_pc_id: str) -> tuple[list[PeerFile], list[SkippedFile]]:
    folder = _require_root(root)
    if not folder.is_dir():
        return [], []
    peers: list[PeerFile] = []
    skipped: list[SkippedFile] = []
    for path in sorted(folder.iterdir()):
        match = _PEER_NAME.fullmatch(path.name)
        if match is None or not path.is_file():
            continue
        try:
            peer = _parse(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError, KeyError, TypeError) as error:
            skipped.append(SkippedFile(path.name, f"unreadable: {error}"))
            continue
        if peer.pc_id != match.group(1):
            skipped.append(SkippedFile(path.name, f"pc_id {peer.pc_id!r} inside does not match the filename"))
            continue
        if peer.pc_id == own_pc_id:
            continue
        peers.append(peer)
    return peers, skipped


def write_own_file(root: Path, pc_id: str, state: SyncState, written_at: str) -> Path:
    folder = _require_root(root)
    folder.mkdir(exist_ok=True)
    payload = {
        "format_version": FORMAT_VERSION,
        "pc_id": pc_id,
        "written_at": written_at,
        "watchlist": [
            {"ticker": r.ticker, "name": r.name, "sector": r.sector, "group_name": r.group_name,
             "weight": r.weight, "updated_at": r.updated_at, "updated_by": r.updated_by}
            for r in sorted(state.rows.values(), key=lambda r: r.ticker)
        ],
        "removed": [
            {"ticker": t.ticker, "removed_at": t.removed_at, "removed_by": t.removed_by}
            for t in sorted(state.removed.values(), key=lambda t: t.ticker)
        ],
    }
    final = own_file_path(root, pc_id)
    temporary = final.with_name(final.name + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    # Atomic on one volume: a crash leaves either the old file or the new one, never half of one.
    os.replace(temporary, final)
    return final
