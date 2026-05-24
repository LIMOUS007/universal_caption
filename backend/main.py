from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from db.database import close_pool, init_pool
from endpoints.websocket import router as ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ---- startup ----
    app.state.redis = aioredis.from_url(settings.redis_url, decode_responses=False)
    await init_pool(settings.database_url)
    print("[main] Redis and Postgres ready")
    yield
    # ---- shutdown ----
    await app.state.redis.aclose()
    await close_pool()
    print("[main] Connections closed")


app = FastAPI(title="Universal Captions API", version="0.1.0", lifespan=lifespan)

# Allow the Chrome extension (chrome-extension://*) and localhost dev origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ws_router)


@app.get("/")
async def health():
    return {"status": "online"}
