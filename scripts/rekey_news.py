"""Re-key news rows stored under the pre-2026-09-10 headline hash, and drop their duplicates.

The 2026-09-10 fix changed a news row's identity to `news_identity_hash(ticker, url)` for
new writes only. Rows already stored kept their headline-based hash. Dedup is
`INSERT OR IGNORE` on the UNIQUE `hash` column, so re-fetching one of those articles did
not collide, and a second copy was stored every time (ERROR-LOG.md 2026-09-26).

For every `(ticker, url)` this keeps the lowest id, deletes the rest, and gives the kept
row the current identity hash, so the write path recognises it from now on. Rows with no
url are left alone: `news_identity_hash(ticker, "")` would fold every url-less article
for a ticker into one identity, and that merge is not this fix's to make.

Deleting rows is irreversible, so the real database is refused without an explicit
opt-in, and backed up first when it is given. This is the same guard as
`reset_snapshots.py` (ERROR-LOG.md 2026-09-04).
"""
from __future__ import annotations

import sqlite3

from apps.api.services.news_service import news_identity_hash
from scripts.reset_snapshots import _REAL_DB, _back_up, _database_path

# Re-bound here so tests can point this module's guard at their own database without
# touching reset_snapshots'.
_REAL_DB = _REAL_DB


def rekey_news(
    conn: sqlite3.Connection, *, allow_real_database: bool = False
) -> dict[str, int]:
    """Collapse each `(ticker, url)` to its lowest id under the current identity hash.

    Returns `{"deleted": rows removed, "rehashed": kept rows whose hash changed}`.
    """
    path = _database_path(conn)
    if path is not None and path == _REAL_DB:
        if not allow_real_database:
            raise RuntimeError(
                f"refusing to re-key news in the real database at {path}.\n"
                "This deletes duplicate rows. If you mean it, call "
                "rekey_news(conn, allow_real_database=True) -- which backs the "
                "database up first -- or run: python scripts/rekey_news.py"
            )
        _back_up(path, "news-rekey")

    groups: dict[tuple[str, str], list[tuple[int, str]]] = {}
    for row_id, ticker, url, hash_ in conn.execute(
        "SELECT id, ticker, url, hash FROM news WHERE url IS NOT NULL AND url <> '' ORDER BY id"
    ):
        groups.setdefault((str(ticker or "").upper(), url), []).append((row_id, hash_))

    deleted = rehashed = 0
    for (ticker, url), members in groups.items():
        keep_id, keep_hash = members[0]
        # Delete before re-hashing: the current identity hash may already be held by a
        # later duplicate, and the UNIQUE column would refuse a second holder.
        extra = [(row_id,) for row_id, _ in members[1:]]
        if extra:
            conn.executemany("DELETE FROM news WHERE id = ?", extra)
            deleted += len(extra)
        identity = news_identity_hash(ticker, url)
        if keep_hash != identity:
            conn.execute("UPDATE news SET hash = ? WHERE id = ?", (identity, keep_id))
            rehashed += 1
    return {"deleted": deleted, "rehashed": rehashed}


if __name__ == "__main__":  # pragma: no cover - operator entry point
    from apps.api.services.db import get_db

    with get_db() as connection:
        print(rekey_news(connection, allow_real_database=True))
