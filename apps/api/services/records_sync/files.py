"""Record peer files: one per PC, read defensively and written atomically (spec §4).

Only names fully matching `records.<pc_id>.json` count, so the watchlist file and cloud conflict
copies are never read as records. An unreadable or invalid file is skipped and reported as a unit,
never read as empty, and never blocks the others. This PC's own file is output only, and is
validated with this module's own reader before it is published.
"""

from __future__ import annotations

import json
import math
import os
import re
from dataclasses import dataclass
from pathlib import Path

from apps.api.services.peer_sync.model import is_valid_ts
from apps.api.services.records_sync.kinds import KINDS, PARENT_UID_KEY, ChildSpec, Kind, payload_columns
from apps.api.services.records_sync.merge import Record, RecordState, RecordTombstone
from apps.api.services.watchlist_sync.files import SYNC_SUBDIR, SkippedFile, SyncFolderUnavailable

FORMAT_VERSION = 1
_PEER_NAME = re.compile(r"records\.([A-Za-z0-9-]+)\.json")
_PC_ID = re.compile(r"[A-Za-z0-9-]+")


@dataclass(frozen=True)
class RecordPeerFile:
    pc_id: str
    written_at: str
    state: RecordState


def own_file_path(root: Path, pc_id: str) -> Path:
    return root / SYNC_SUBDIR / f"records.{pc_id}.json"


def _require_root(root: Path) -> Path:
    if not root.is_dir():
        raise SyncFolderUnavailable(f"sync folder {root} does not exist or is not a folder")
    return root / SYNC_SUBDIR


def _ts(value, what: str) -> str:
    if not isinstance(value, str) or not is_valid_ts(value):
        raise ValueError(f"{what}={value!r} is not a valid UTC millisecond timestamp")
    return value


def _pc(value, what: str) -> str:
    if not isinstance(value, str) or not _PC_ID.fullmatch(value):
        raise ValueError(f"{what}={value!r} is not a pc_id")
    return value


def _check_tree(node: dict, columns: tuple[str, ...], children: tuple[ChildSpec, ...], what: str,
                not_null: tuple[str, ...] = (), domains: tuple[tuple[str, tuple], ...] = ()) -> None:
    if not isinstance(node, dict):
        raise ValueError(f"{what} is not an object")
    expected = set(columns) | {child.key for child in children}
    present = set(node)
    if expected - present:
        raise ValueError(f"{what} is missing {sorted(expected - present)}")
    # A column this schema does not know means the peer runs a newer version. Applying the rest
    # would silently drop whatever the owner wrote in it.
    if present - expected:
        raise ValueError(f"{what} has unknown columns {sorted(present - expected)}")
    # JSON has no NaN/Infinity; a file only Python's lenient json module can parse defeats the
    # point of validating peers' files. A dict or list in a scalar column would only fail later,
    # at the SQLite bind, with a far less useful error.
    for column in columns:
        value = node[column]
        if not (value is None or isinstance(value, (bool, int, float, str))):
            raise ValueError(f"{what}.{column}={value!r} is not a scalar (got {type(value).__name__})")
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError(f"{what}.{column}={value!r} is not a finite number")
    # A value the local schema's NOT NULL or CHECK would refuse passes every check above, and
    # would only fail at apply -- rolling back every kind on every sync, with no file reported.
    for column in not_null:
        if node[column] is None:
            raise ValueError(f"{what}.{column} is null, but the local schema requires a value")
    for column, allowed in domains:
        if node[column] not in allowed:
            raise ValueError(f"{what}.{column}={node[column]!r} is not one of {list(allowed)}")
    for child in children:
        rows = node[child.key]
        if not isinstance(rows, list):
            raise ValueError(f"{what}.{child.key} is not a list")
        for index, row in enumerate(rows):
            _check_tree(row, child.columns, child.children, f"{what}.{child.key}[{index}]",
                        child.not_null, child.domains)


def _check_payload(kind: Kind, uid: str, payload: dict) -> None:
    if kind.children:
        required = {"case", *(c.key for c in kind.children if not c.optional)}
        allowed = required | {c.key for c in kind.children if c.optional}
        if not isinstance(payload, dict) or not required <= set(payload) <= allowed:
            raise ValueError(f"{kind.name} payload must hold 'case' and {[c.key for c in kind.children]}")
        _check_tree(payload["case"], payload_columns(kind), (), f"{kind.name}.case", kind.not_null, kind.domains)
        if kind.lineage_column:
            parent_uid = payload["case"][PARENT_UID_KEY]
            if not (parent_uid is None or (isinstance(parent_uid, str) and parent_uid)):
                raise ValueError(f"{kind.name}.case.{PARENT_UID_KEY}={parent_uid!r} is not a uid or null")
        for child in kind.children:
            rows = payload.get(child.key, []) if child.optional else payload[child.key]
            if not isinstance(rows, list):
                raise ValueError(f"{kind.name}.{child.key} is not a list")
            for index, row in enumerate(rows):
                _check_tree(row, child.columns, child.children, f"{kind.name}.{child.key}[{index}]",
                            child.not_null, child.domains)
        return
    _check_tree(payload, kind.columns, (), f"{kind.name} payload", kind.not_null, kind.domains)
    # A natural-identity kind carries its identity in the payload too; the two must agree, or
    # apply would write the row under a key another record owns.
    if not kind.generates_uid and kind.singleton_uid is None and payload[kind.uid_column] != uid:
        raise ValueError(f"{kind.name} {uid!r}: payload {kind.uid_column}={payload[kind.uid_column]!r} differs from its uid")


def _parse(payload: dict) -> RecordPeerFile:
    if not isinstance(payload, dict):
        raise ValueError("the file is not a JSON object")
    if payload.get("format_version") != FORMAT_VERSION:
        raise ValueError(f"unsupported format_version {payload.get('format_version')!r}")
    if not isinstance(payload["records"], list) or not isinstance(payload["removed"], list):
        raise ValueError("records and removed must both be lists")

    records: dict[tuple[str, str], Record] = {}
    for raw in payload["records"]:
        kind = KINDS.get(raw["kind"])
        if kind is None:
            raise ValueError(f"unknown kind {raw['kind']!r}")
        uid = raw["uid"]
        if not isinstance(uid, str) or not uid:
            raise ValueError(f"{raw['kind']}: invalid uid {uid!r}")
        key = (kind.name, uid)
        if key in records:
            raise ValueError(f"duplicate record {key}")
        _check_payload(kind, uid, raw["payload"])
        records[key] = Record(
            kind=kind.name, uid=uid,
            updated_at=_ts(raw["updated_at"], f"{kind.name}.{uid} updated_at"),
            updated_by=_pc(raw["updated_by"], f"{kind.name}.{uid} updated_by"),
            payload=raw["payload"],
        )

    removed: dict[tuple[str, str], RecordTombstone] = {}
    for raw in payload["removed"]:
        if raw["kind"] not in KINDS:
            raise ValueError(f"unknown kind {raw['kind']!r}")
        uid = raw["uid"]
        if not isinstance(uid, str) or not uid:
            raise ValueError(f"{raw['kind']}: invalid tombstone uid {uid!r}")
        key = (raw["kind"], uid)
        if key in removed:
            raise ValueError(f"duplicate tombstone {key}")
        removed[key] = RecordTombstone(
            kind=raw["kind"], uid=uid,
            removed_at=_ts(raw["removed_at"], f"{key} removed_at"),
            removed_by=_pc(raw["removed_by"], f"{key} removed_by"),
        )

    return RecordPeerFile(
        pc_id=_pc(payload["pc_id"], "pc_id"),
        written_at=_ts(payload["written_at"], "written_at"),
        state=RecordState(records=records, removed=removed),
    )


def read_peer_files(root: Path, own_pc_id: str) -> tuple[list[RecordPeerFile], list[SkippedFile]]:
    folder = _require_root(root)
    if not folder.is_dir():
        return [], []
    peers: list[RecordPeerFile] = []
    skipped: list[SkippedFile] = []
    for path in sorted(folder.iterdir()):
        match = _PEER_NAME.fullmatch(path.name)
        if match is None or not path.is_file():
            continue
        try:
            peer = _parse(json.loads(path.read_text(encoding="utf-8")))
        except Exception as error:  # noqa: BLE001 - each file is untrusted, independent input
            skipped.append(SkippedFile(path.name, f"unreadable: {type(error).__name__}: {error}"))
            continue
        if peer.pc_id != match.group(1):
            skipped.append(SkippedFile(path.name, f"pc_id {peer.pc_id!r} inside does not match the filename"))
            continue
        if peer.pc_id == own_pc_id:
            continue
        peers.append(peer)
    return peers, skipped


def _payload_of(state: RecordState, pc_id: str, written_at: str) -> dict:
    return {
        "format_version": FORMAT_VERSION,
        "pc_id": pc_id,
        "written_at": written_at,
        "records": [
            {"kind": r.kind, "uid": r.uid, "updated_at": r.updated_at, "updated_by": r.updated_by,
             "payload": r.payload}
            for r in sorted(state.records.values(), key=lambda r: (r.kind, r.uid))
        ],
        "removed": [
            {"kind": t.kind, "uid": t.uid, "removed_at": t.removed_at, "removed_by": t.removed_by}
            for t in sorted(state.removed.values(), key=lambda t: (t.kind, t.uid))
        ],
    }


def write_own_file(root: Path, pc_id: str, state: RecordState, written_at: str) -> Path:
    folder = _require_root(root)
    folder.mkdir(exist_ok=True)
    payload = _payload_of(state, pc_id, written_at)
    # Fail loudly here rather than silently on every peer: the reader is the judge of what is
    # publishable.
    _parse(payload)
    final = own_file_path(root, pc_id)
    temporary = final.with_name(final.name + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    os.replace(temporary, final)
    return final
