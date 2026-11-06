install: pip install -r requirements.txt
run: python main.py
ui: http://localhost:8000/
debug:
- periods: python .\services\fetcher\debug_candles.py --symbol BTCUSDT --tf 30m --periods 10
