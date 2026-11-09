import pytest
from pydantic import ValidationError
from app.schemas import SymbolCreate

def test_symbol_normalized():
    assert SymbolCreate(symbol=" btcusdt ").symbol == "BTCUSDT"

def test_symbol_rejects_punctuation():
    with pytest.raises(ValidationError):
        SymbolCreate(symbol="BTC/USDT")
