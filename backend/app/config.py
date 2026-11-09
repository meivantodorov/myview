from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")
    app_env: str = "development"
    log_level: str = "INFO"
    log_json: bool = True
    api_port: int = 8000
    api_key: str = ""
    database_url: str = "postgresql://candles:change_me@localhost:5432/candles"
    binance_rest_url: str = "https://api.binance.com"
    binance_ws_url: str = "wss://stream.binance.com:9443/ws"
    binance_request_timeout: float = 15
    binance_max_concurrent_requests: int = 3
    binance_backoff_max_seconds: int = 60
    watermark_seconds: int = 120
    reconcile_interval_seconds: int = 300
    recovery_interval_seconds: int = 60
    history_burst_default: int = 500
    backfill_batch_size: int = 1000
    max_candles_per_request: int = 5000
    active_symbol_limit: int = 5
    client_ws_heartbeat_seconds: int = 30

@lru_cache
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
