"""
Structured logging setup.

Configures JSON-formatted logging for production and human-readable
logging for development. Provides get_logger(name) factory function.
"""

import json
import logging
import sys
from datetime import datetime, timezone


class JSONFormatter(logging.Formatter):
    """Emit each log record as a single JSON object (for production)."""

    def format(self, record: logging.LogRecord) -> str:
        log_obj = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info and record.exc_info[0] is not None:
            log_obj["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_obj)


class DevFormatter(logging.Formatter):
    """Human-readable coloured formatter for local development."""

    COLORS = {
        "DEBUG": "\033[36m",     # cyan
        "INFO": "\033[32m",      # green
        "WARNING": "\033[33m",   # yellow
        "ERROR": "\033[31m",     # red
        "CRITICAL": "\033[1;31m",  # bold red
    }
    RESET = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelname, self.RESET)
        ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
        base = f"{color}{ts} [{record.levelname:<8}]{self.RESET} {record.name}: {record.getMessage()}"
        if record.exc_info and record.exc_info[0] is not None:
            base += "\n" + self.formatException(record.exc_info)
        return base


_configured = False


def _configure_root(is_dev: bool = True) -> None:
    """Configure the root logger once."""
    global _configured
    if _configured:
        return
    _configured = True

    root = logging.getLogger()
    root.setLevel(logging.DEBUG if is_dev else logging.INFO)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(DevFormatter() if is_dev else JSONFormatter())
    root.handlers = [handler]

    # Quieten noisy third-party loggers
    for name in ("httpx", "httpcore", "uvicorn.access", "watchfiles"):
        logging.getLogger(name).setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """Return a named logger. Lazily configures root logger on first call."""
    # Defer import to avoid circular dependency at module level
    try:
        from app.config import get_settings
        is_dev = get_settings().is_development
    except Exception:
        is_dev = True

    _configure_root(is_dev)
    return logging.getLogger(name)
