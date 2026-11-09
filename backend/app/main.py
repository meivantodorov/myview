from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db import connect, close
from app.logging_config import configure_logging
from app.providers.binance import BinanceClient
from app.services.symbol_manager import SymbolManager
from app.services.aggregator_worker import AggregatorWorker
from app.api.routes import router, admin
from app.api.websocket import router as ws_router, hub
from app.api.health import router as health_router
from app.config import settings

configure_logging()
log = logging.getLogger(__name__)
binance_client = None
symbol_manager = None
aggregator_worker = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global binance_client, symbol_manager, aggregator_worker
    await connect()
    binance_client = BinanceClient()
    symbol_manager = SymbolManager(binance_client)
    aggregator_worker = AggregatorWorker()
    await aggregator_worker.start()
    await symbol_manager.start()
    log.info("Service started", extra={"component":"lifecycle"})
    yield
    log.info("Service stopping", extra={"component":"lifecycle"})
    await symbol_manager.stop()
    await aggregator_worker.stop()
    await binance_client.close()
    await close()

app = FastAPI(title="Binance Candle Service", version="1.0.0",
    description="Locally synchronized Binance Spot OHLCV data service", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(router)
app.include_router(admin)
app.include_router(ws_router)
app.include_router(health_router)
