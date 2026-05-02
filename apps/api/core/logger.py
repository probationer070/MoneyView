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

    @staticmethod
    def _first_present(*values):
        for value in values:
            if value not in (None, ""):
                return value
        return ""

    @staticmethod
    def _request_summary(record: logging.LogRecord, *, failed: bool = False) -> str:
        source = "api.request"
        method = getattr(record, "method", "") or "-"
        path = getattr(record, "path", "") or "-"
        status = getattr(record, "status_code", "") or (500 if failed else "-")
        elapsed_ms = ConsoleFormatter._first_present(
            getattr(record, "duration_ms", ""),
            getattr(record, "elapsed_ms", ""),
        )
        parts = [
            f"src={source}",
            f"{method} {path}",
            f"status={status}",
        ]
        if elapsed_ms != "":
            parts.append(f"elapsed={elapsed_ms}ms")
        if failed:
            parts.append("outcome=failed")
        request_id = getattr(record, "request_id", "")
        if request_id:
            parts.append(f"request_id={request_id}")
        return " | ".join(parts)

    @staticmethod
    def _transport_summary(record: logging.LogRecord) -> str:
        source = "api.transport"
        method = getattr(record, "method", "") or "-"
        path = getattr(record, "path", "") or "-"
        status = getattr(record, "status_code", "")
        elapsed_ms = ConsoleFormatter._first_present(
            getattr(record, "elapsed_ms", ""),
            getattr(record, "duration_ms", ""),
        )
        transport_kind = getattr(record, "transport_kind", "") or "http"

        parts = [
            f"src={source}",
            f"{method} {path}",
            f"transport={transport_kind}",
        ]
        if status != "":
            parts.append(f"status={status}")

        phase = getattr(record, "phase", "")
        if phase:
            parts.append(f"phase={phase}")

        progress_pct = getattr(record, "progress_pct", None)
        if progress_pct not in (None, ""):
            parts.append(f"progress={progress_pct}%")

        bytes_sent = getattr(record, "bytes_sent", None)
        total_bytes = getattr(record, "total_bytes", None)
        if bytes_sent not in (None, "") and total_bytes not in (None, ""):
            parts.append(f"bytes={bytes_sent}/{total_bytes}")
        elif bytes_sent not in (None, ""):
            parts.append(f"bytes={bytes_sent}")

        chunk_count = getattr(record, "chunk_count", None)
        if chunk_count not in (None, ""):
            parts.append(f"chunks={chunk_count}")

        completed = getattr(record, "completed", None)
        if completed is True:
            parts.append("completed=true")

        if elapsed_ms != "":
            parts.append(f"elapsed={elapsed_ms}ms")

        request_id = getattr(record, "request_id", "")
        if request_id:
            parts.append(f"request_id={request_id}")

        return " | ".join(parts)

    def format(self, record: logging.LogRecord) -> str:
        timestamp = self.formatTime(record, self.datefmt)
        if record.msg == "request.completed method=%s path=%s status=%s duration_ms=%.1f client_ip=%s":
            return f"{timestamp} | {record.levelname:<8} | {self._request_summary(record)}"
        if record.msg == "request.failed method=%s path=%s duration_ms=%.1f client_ip=%s":
            return f"{timestamp} | {record.levelname:<8} | {self._request_summary(record, failed=True)}"
        if record.msg in {
            "transport.progress method=%s path=%s status=%s bytes_sent=%s total_bytes=%s progress_pct=%.1f elapsed_ms=%.1f completed=%s",
            "transport.progress method=%s path=%s status=%s bytes_sent=%s chunk_count=%s elapsed_ms=%.1f completed=%s",
            "transport.progress method=%s path=%s status=%s bytes_sent=%s total_bytes=%s progress_pct=%s chunk_count=%s elapsed_ms=%.1f completed=%s",
            "transport.phase method=%s path=%s phase=%s elapsed_ms=%.1f bytes_sent=%s chunk_count=%s completed=%s",
        }:
            return f"{timestamp} | {record.levelname:<8} | {self._transport_summary(record)}"

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
