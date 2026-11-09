import asyncio
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.db import get_pool
from app.storage.candles import get_latest
from app.api.routes import serialize
from app.timeframes import TIMEFRAMES

router = APIRouter()
log = logging.getLogger(__name__)

class ClientHub:
    def __init__(self):
        self.subscriptions: dict[WebSocket, set[tuple[str, str]]] = {}
        self.lock = asyncio.Lock()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        async with self.lock:
            self.subscriptions[ws] = set()

    async def subscribe(self, ws: WebSocket, symbol: str, timeframe: str):
        async with self.lock:
            if ws in self.subscriptions:
                self.subscriptions[ws].add((symbol, timeframe))

    async def disconnect(self, ws: WebSocket):
        async with self.lock:
            self.subscriptions.pop(ws, None)

    async def publish(self, event: dict):
        key = (event.get("symbol"), event.get("timeframe"))
        async with self.lock:
            clients = [ws for ws, subs in self.subscriptions.items() if key in subs]
        dead = []
        for client in clients:
            try:
                await client.send_json(event)
            except Exception:
                dead.append(client)
        for client in dead:
            await self.disconnect(client)

hub = ClientHub()

@router.websocket("/ws")
async def client_stream(ws: WebSocket):
    await hub.connect(ws)
    try:
        await ws.send_json({"type":"CONNECTED","message":"Send {symbol, timeframe} to subscribe"})
        while True:
            message = await ws.receive_json()
            symbol = str(message.get("symbol","")).upper()
            timeframe = str(message.get("timeframe","1m"))
            if timeframe not in TIMEFRAMES:
                await ws.send_json({"type":"ERROR","message":"Unsupported timeframe"})
                continue
            async with get_pool().acquire() as conn:
                active = await conn.fetchval("SELECT active FROM symbols WHERE symbol=$1",symbol)
            if not active:
                await ws.send_json({"type":"ERROR","message":"Symbol is not active"})
                continue
            rows = await get_latest(symbol,timeframe,500)
            await ws.send_json({"type":"HISTORY_BURST","symbol":symbol,"timeframe":timeframe,
                                "candles":[serialize(r) for r in rows]})
            await hub.subscribe(ws,symbol,timeframe)
            await ws.send_json({"type":"SUBSCRIBED","symbol":symbol,"timeframe":timeframe})
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("Client WebSocket failed", extra={"component":"client-ws"})
    finally:
        await hub.disconnect(ws)
