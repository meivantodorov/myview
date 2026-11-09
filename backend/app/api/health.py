from fastapi import APIRouter
from app.db import get_pool

router = APIRouter()

@router.get("/health/live")
async def live():
    return {"status":"alive"}

@router.get("/health/ready")
async def ready():
    try:
        await get_pool().fetchval("SELECT 1")
        db = True
    except Exception:
        db = False
    from app import main
    manager = main.symbol_manager
    return {"status":"ready" if db else "not_ready","database":db,
            "active_workers":list(manager.workers) if manager else []}

@router.get("/diagnostics")
async def diagnostics():
    from app import main
    manager = main.symbol_manager
    symbols = await get_pool().fetch("""SELECT s.symbol,s.active,ss.state,ss.last_sync_at,ss.last_error,
      (SELECT COUNT(*) FROM candles c WHERE c.symbol=s.symbol AND c.timeframe='1m') AS candle_count,
      (SELECT MAX(open_time) FROM candles c WHERE c.symbol=s.symbol AND c.timeframe='1m') AS latest_open_time,
      (SELECT COUNT(*) FROM aggregation_jobs j WHERE j.symbol=s.symbol AND j.status='PENDING') AS pending_aggregation_jobs
      FROM symbols s LEFT JOIN sync_status ss USING(symbol) ORDER BY s.symbol""")
    return {"database":"connected","active_workers":list(manager.workers) if manager else [],
            "symbols":[dict(r) for r in symbols]}
