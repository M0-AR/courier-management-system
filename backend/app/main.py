"""SwiftCourier FastAPI app — lifespan, CORS, hardening, health, routers, OpenAPI.

2026 production baseline (voted): request-ID tracing, security headers,
per-IP rate limiting (in-memory; Redis path documented for multi-replica),
DB-verifying health checks. CSP deliberately omitted: Swagger UI loads its
bundle from the jsdelivr CDN, and a backend CSP would break /docs.
"""
import time
import uuid
from collections import defaultdict
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .config import get_settings
from .database import Base, SessionLocal, engine
from .routers import couriers, stats

settings = get_settings()

# --- rate limiting (fixed window, per-IP, SHARED counter) --------------------
# Voted 2026 pattern (FastAPI + Postgres + Redis): in-memory counters lie the
# moment you run >1 worker — verified live on this stack (2 workers slipped
# 130 requests past a 120 limit). Redis gives every worker one counter.
# Fail-open by design: if Redis is down we serve traffic, never 500.
RATE_LIMIT_PER_MINUTE = 120
_RATE_EXEMPT = {"/api/health", "/api/ready", "/docs", "/openapi.json", "/redoc"}
_RATE_MEM: dict[str, list[float]] = defaultdict(list)

try:
    import redis as _redis

    _redis_client = _redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=1, socket_timeout=1)
    _redis_client.ping()
except Exception:
    _redis_client = None  # local dev / tests: documented per-process fallback


def _over_limit(ip: str) -> bool:
    window = 60
    if _redis_client is not None:
        try:
            key = f"ratelimit:{ip}:{int(time.time()) // window}"
            count = _redis_client.incr(key)
            if count == 1:
                _redis_client.expire(key, window)
            return count > RATE_LIMIT_PER_MINUTE
        except Exception:
            pass  # Redis down → fail open to the memory fallback below
    now = time.monotonic()
    bucket = _RATE_MEM[ip]
    while bucket and bucket[0] < now - window:
        bucket.pop(0)
    if len(bucket) >= RATE_LIMIT_PER_MINUTE:
        return True
    bucket.append(now)
    return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield
    engine.dispose()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Production Courier Management API — add, track, price, and report on shipments.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def hardening_middleware(request: Request, call_next):
    # 1. Request ID (trace every request end-to-end).
    request_id = request.headers.get("X-Request-ID", uuid.uuid4().hex[:16])
    # 2. Rate limit (skip health/docs so probes never 429).
    if request.url.path not in _RATE_EXEMPT and not request.url.path.startswith("/docs"):
        ip = request.client.host if request.client else "unknown"
        if _over_limit(ip):
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Slow down and retry."},
                headers={"Retry-After": "60", "X-Request-ID": request_id},
            )
    response = await call_next(request)
    # 3. Security headers on every API response.
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


app.include_router(couriers.router, prefix="/api")
app.include_router(stats.router, prefix="/api")


def _db_ok() -> bool:
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


@app.get("/api/health", tags=["ops"])
def health():
    ok = _db_ok()
    return {
        "status": "ok" if ok else "degraded",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "database": "up" if ok else "down",
    }


@app.get("/api/ready", tags=["ops"])
def ready():
    # Kubernetes-style readiness: 503 until the DB answers.
    if not _db_ok():
        return JSONResponse(status_code=503, content={"ready": False})
    return {"ready": True}


@app.get("/", tags=["ops"])
def root():
    return {"app": settings.APP_NAME, "docs": "/docs", "health": "/api/health"}
