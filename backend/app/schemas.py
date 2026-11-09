from datetime import datetime
from pydantic import BaseModel, Field, field_validator

class SymbolCreate(BaseModel):
    symbol: str = Field(min_length=5, max_length=20, examples=["BTCUSDT"])
    @field_validator("symbol")
    @classmethod
    def normalize(cls, value: str) -> str:
        value = value.strip().upper()
        if not value.isalnum():
            raise ValueError("symbol must contain only letters and digits")
        return value

class CandleOut(BaseModel):
    symbol: str
    timeframe: str
    open_time: datetime
    close_time: datetime
    open: str
    high: str
    low: str
    close: str
    volume: str
    quote_volume: str = "0"
    trades: int = 0
    is_closed: bool

class SymbolOut(BaseModel):
    symbol: str
    active: bool
    added_at: datetime
    status: str | None = None
    last_sync_at: datetime | None = None
    last_error: str | None = None
