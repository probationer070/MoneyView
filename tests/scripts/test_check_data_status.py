"""check_data_status.py answers one question honestly: is there real data here, or not.

Each fixture builds a throwaway database on the real schema -- gather_status must read
the same tables the API reads, so a schema drift between this test and db.py's actual
CREATE TABLE statements would otherwise go unnoticed."""

import json
import sqlite3
from pathlib import Path

import pytest

from apps.api.services.db import _CREATE_SCHEMA_SQL
from scripts.check_data_status import gather_status, render_text


def _make_empty_db(path: Path) -> None:
    conn = sqlite3.connect(str(path))
    conn.executescript(_CREATE_SCHEMA_SQL)
    conn.commit()
    conn.close()


def _make_seed(path: Path, tickers: list[str]) -> None:
    path.write_text(
        json.dumps({"custom": {"targets": [{"ticker": t} for t in tickers]}}),
        encoding="utf-8",
    )


def test_a_missing_file_is_reported_as_not_created_not_as_an_error(tmp_path):
    status = gather_status(db_path=tmp_path / "does-not-exist.db")

    assert status["db_exists"] is False
    assert status["verdict"] == "not_created"


def test_not_created_never_calls_stat_on_a_file_that_does_not_exist(tmp_path):
    """A FileNotFoundError here would mean the not-created branch was never truly taken
    -- something read the file anyway and merely swallowed the failure."""
    missing = tmp_path / "definitely-not-here.db"
    assert not missing.exists()

    status = gather_status(db_path=missing)

    assert "db_size_bytes" not in status


def test_a_schema_only_database_is_empty_not_ready(tmp_path):
    """The distinction the whole feature exists for: a database that init_db() created
    but that no route has ever populated must not be reported as usable."""
    db_path = tmp_path / "empty.db"
    _make_empty_db(db_path)
    seed_path = tmp_path / "seed.json"
    _make_seed(seed_path, ["AAPL", "MSFT"])

    status = gather_status(db_path=db_path, seed_path=seed_path)

    assert status["db_exists"] is True
    assert status["verdict"] == "empty"
    assert status["priced_tickers"] == 0
    assert status["tracked_tickers"] == 2


def test_a_database_with_most_tracked_tickers_priced_is_ready(tmp_path):
    db_path = tmp_path / "ready.db"
    _make_empty_db(db_path)
    conn = sqlite3.connect(str(db_path))
    for ticker in ["AAPL", "MSFT", "NVDA"]:
        conn.execute(
            "INSERT INTO watchlist (ticker, name, sector, group_name, weight) "
            "VALUES (?, ?, 'Technology', 'built_in', 0.33)",
            (ticker, ticker),
        )
        conn.execute(
            "INSERT INTO stocks (ticker, date, open, high, low, close, volume) "
            "VALUES (?, '2026-09-10', 1, 1, 1, 1, 1)",
            (ticker,),
        )
    conn.commit()
    conn.close()
    seed_path = tmp_path / "seed.json"
    _make_seed(seed_path, ["AAPL", "MSFT", "NVDA"])

    status = gather_status(db_path=db_path, seed_path=seed_path)

    assert status["verdict"] == "ready"
    assert status["priced_tickers"] == 3
    assert status["watchlist_rows"] == 3


def test_fewer_than_half_the_tracked_tickers_priced_is_partial_not_ready(tmp_path):
    """A database that has SOME data must not be reported the same as one that has
    ENOUGH data -- 'ready' is a claim that browsing the watchlist will mostly work."""
    db_path = tmp_path / "partial.db"
    _make_empty_db(db_path)
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "INSERT INTO stocks (ticker, date, open, high, low, close, volume) "
        "VALUES ('AAPL', '2026-09-10', 1, 1, 1, 1, 1)"
    )
    conn.commit()
    conn.close()
    seed_path = tmp_path / "seed.json"
    _make_seed(seed_path, ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL"])

    status = gather_status(db_path=db_path, seed_path=seed_path)

    assert status["verdict"] == "partial"


def test_gather_status_never_writes_to_the_database_or_the_seed_file(tmp_path):
    """A status check that mutates what it is checking is not read-only, whatever it
    calls itself. The `mode=ro` connection string is the guarantee; this proves it
    rather than merely asserting it exists in the source."""
    db_path = tmp_path / "readonly.db"
    _make_empty_db(db_path)
    before = db_path.read_bytes()
    seed_path = tmp_path / "seed.json"
    _make_seed(seed_path, ["AAPL"])
    seed_before = seed_path.read_bytes()

    gather_status(db_path=db_path, seed_path=seed_path)

    assert db_path.read_bytes() == before
    assert seed_path.read_bytes() == seed_before


def test_a_connection_refusal_is_not_silently_treated_as_missing(tmp_path):
    """mode=ro on a path that is not a valid SQLite file must raise, not be caught by
    the same branch that handles a genuinely absent file -- those are different facts
    about the database and the report must not conflate them."""
    not_a_db = tmp_path / "not-a-database.db"
    not_a_db.write_text("this is not sqlite", encoding="utf-8")

    with pytest.raises(sqlite3.DatabaseError):
        gather_status(db_path=not_a_db)


def test_render_text_names_the_on_demand_mechanism_when_empty(tmp_path):
    """The report exists to answer 'can I download or import data' -- an empty verdict
    that did not say how would not answer the question it was built for."""
    db_path = tmp_path / "empty.db"
    _make_empty_db(db_path)
    status = gather_status(db_path=db_path, seed_path=tmp_path / "no-seed.json")

    text = render_text(status)

    assert "on demand" in text
    assert "MONEYVIEW_PREWARM_TICKERS" in text


def test_render_text_for_a_missing_database_does_not_claim_bulk_download(tmp_path):
    """This repo has no bulk 'download everything' command. Claiming one exists would
    send a reader looking for a script that is not there."""
    status = gather_status(db_path=tmp_path / "missing.db")

    text = render_text(status)

    assert "bulk" in text.lower() and "not" in text.lower()


def _insert_watchlist(db_path: Path, tickers: list[str]) -> None:
    conn = sqlite3.connect(str(db_path))
    for ticker in tickers:
        conn.execute(
            "INSERT INTO watchlist (ticker, name, sector, group_name, weight) "
            "VALUES (?, ?, '', 'custom', 0.0)",
            (ticker, ticker),
        )
    conn.commit()
    conn.close()


def test_render_text_reports_seed_tickers_the_database_has_not_imported(tmp_path):
    """The drift this line exists for: the seed is committed with tickers a machine that
    bootstrapped earlier never received, because the bootstrap only ever runs once."""
    db_path = tmp_path / "drifted.db"
    _make_empty_db(db_path)
    _insert_watchlist(db_path, ["AAPL", "MSFT", "NVDA"])
    seed_path = tmp_path / "seed.json"
    _make_seed(seed_path, ["AAPL", "MSFT", "NVDA", "SPCX", "CRCL"])

    status = gather_status(db_path=db_path, seed_path=seed_path)
    text = render_text(status)

    assert status["seed_not_imported"] == 2
    assert "Watchlist: 3/5 tracked tickers  (2 in seed not yet imported)" in text


def test_a_watchlist_holding_every_seed_ticker_reports_no_drift(tmp_path):
    """Silence is the claim here. A machine that has imported everything must not be told
    it is behind, and the line must stay in its existing one-line style."""
    db_path = tmp_path / "aligned.db"
    _make_empty_db(db_path)
    _insert_watchlist(db_path, ["AAPL", "MSFT"])
    seed_path = tmp_path / "seed.json"
    _make_seed(seed_path, ["AAPL", "MSFT"])

    status = gather_status(db_path=db_path, seed_path=seed_path)
    text = render_text(status)

    assert status["seed_not_imported"] == 0
    assert "Watchlist: 2/2 tracked tickers" in text
    assert "not yet imported" not in text


def test_locally_curated_tickers_do_not_mask_missing_seed_tickers(tmp_path):
    """The reason this is a set difference and not `tracked - watchlist_rows`.

    Three rows against a three-ticker seed: the counts agree exactly, so a subtraction
    reports no drift at all -- while two of the seed's tickers are in fact missing. That
    is a false negative on precisely the condition the merge exists to repair, and it is
    the mutation this test was written to catch."""
    db_path = tmp_path / "curated.db"
    _make_empty_db(db_path)
    _insert_watchlist(db_path, ["AAPL", "LOCAL1", "LOCAL2"])
    seed_path = tmp_path / "seed.json"
    _make_seed(seed_path, ["AAPL", "MSFT", "NVDA"])

    status = gather_status(db_path=db_path, seed_path=seed_path)

    assert status["watchlist_rows"] == status["tracked_tickers"] == 3
    assert status["seed_not_imported"] == 2
    assert "(2 in seed not yet imported)" in render_text(status)


def test_a_database_with_no_readable_seed_omits_the_comparison(tmp_path):
    """No seed is not the same fact as a seed with nothing missing, so the line must omit
    the comparison rather than report a drift of zero against a file it never read."""
    db_path = tmp_path / "no-seed.db"
    _make_empty_db(db_path)
    _insert_watchlist(db_path, ["AAPL"])

    status = gather_status(db_path=db_path, seed_path=tmp_path / "absent.json")
    text = render_text(status)

    assert status["tracked_tickers"] is None
    assert status["seed_not_imported"] is None
    assert "Watchlist: 1 tracked tickers" in text
    assert "not yet imported" not in text
