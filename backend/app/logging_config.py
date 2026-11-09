import json
import logging
import sys
from pathlib import Path
from logging.handlers import RotatingFileHandler
from datetime import datetime, timezone
from app.config import settings

class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in ("symbol", "component", "event", "request_id", "error"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)

def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if settings.log_json else logging.Formatter(
        "%(asctime)s %(levelname)s %(name)s: %(message)s"
    ))
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    try:
        Path("logs").mkdir(parents=True, exist_ok=True)
        file_handler = RotatingFileHandler("logs/service.log", maxBytes=10_000_000,
                                           backupCount=5, encoding="utf-8")
        file_handler.setFormatter(JsonFormatter() if settings.log_json else logging.Formatter(
            "%(asctime)s %(levelname)s %(name)s: %(message)s"
        ))
        root.addHandler(file_handler)
    except OSError:
        # stdout remains available when the mounted log directory is read-only.
        root.warning("File logging unavailable; continuing with stdout")
    root.setLevel(settings.log_level.upper())
