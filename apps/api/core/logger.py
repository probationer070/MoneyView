import logging
import os
import sys
from pathlib import Path

from pythonjsonlogger import jsonlogger

_DEFAULT_LOG_PATH = Path(os.getenv("API_LOG_PATH", "data/cache/logs/api-server.log"))
_CONFIGURED_SENTINEL = "_moneyview_logging_configured"


class ConsoleFormatter(logging.Formatter):
    """Readable console formatter for live local debugging."""

    default_msec_format = "%s.%03d"

    def format(self, record: logging.LogRecord) -> str:
        timestamp = self.formatTime(record, self.datefmt)
        location = getattr(record, "logger_name", record.name)
        message = record.getMessage()
        request_id = getattr(record, "request_id", "")
        suffix = f" request_id={request_id}" if request_id else ""
        return f"{timestamp} | {record.levelname:<8} | {location} | {message}{suffix}"


def _build_console_handler() -> logging.Handler:
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(logging.INFO)
    handler.setFormatter(ConsoleFormatter(datefmt="%Y-%m-%d %H:%M:%S"))
    return handler


def _build_file_handler(log_path: Path) -> logging.Handler:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    handler = logging.FileHandler(log_path, encoding="utf-8")
    handler.setLevel(logging.INFO)
    handler.setFormatter(
        jsonlogger.JsonFormatter(
            "%(asctime)s %(levelname)s %(name)s %(message)s %(request_id)s %(method)s %(path)s %(status_code)s %(duration_ms)s %(client_ip)s %(bytes_sent)s %(total_bytes)s %(progress_pct)s %(chunk_count)s %(phase)s %(transport_kind)s %(completed)s %(elapsed_ms)s"
        )
    )
    return handler


def get_log_path() -> Path:
    """Return the configured persistent API log file path."""
    return Path(os.getenv("API_LOG_PATH", str(_DEFAULT_LOG_PATH)))


def read_log_tail(*, max_lines: int = 200) -> list[str]:
    """Read the most recent lines from the persistent API log file."""
    log_path = get_log_path()
    if max_lines <= 0:
        return []
    if not log_path.exists():
        return []

    try:
        with log_path.open("r", encoding="utf-8") as handle:
            lines = handle.readlines()
    except OSError:
        return []

    return [line.rstrip("\r\n") for line in lines[-max_lines:]]


def configure_logging() -> None:
    """Configure shared logging for app, middleware, and Uvicorn."""
    root_logger = logging.getLogger()
    if getattr(root_logger, _CONFIGURED_SENTINEL, False):
        return

    root_logger.handlers.clear()
    root_logger.setLevel(logging.INFO)

    log_path = _DEFAULT_LOG_PATH
    root_logger.addHandler(_build_console_handler())
    root_logger.addHandler(_build_file_handler(log_path))

    for logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"):
        target_logger = logging.getLogger(logger_name)
        target_logger.handlers.clear()
        target_logger.setLevel(logging.INFO)
        target_logger.propagate = True

    setattr(root_logger, _CONFIGURED_SENTINEL, True)


def setup_logger(name: str) -> logging.Logger:
    """Return a logger bound to the shared MoneyView logging pipeline."""
    configure_logging()
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    return logger
