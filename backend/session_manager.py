import uuid
from datetime import datetime, timezone

from redis.asyncio import Redis

from config import settings

_SESSION_PREFIX = "uc:session:"


class SessionManager:
    def __init__(self, redis: Redis) -> None:
        self._r = redis

    # ------------------------------------------------------------------
    # Key helper
    # ------------------------------------------------------------------
    @staticmethod
    def _key(session_id: str) -> str:
        return f"{_SESSION_PREFIX}{session_id}"

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    async def create(
        self,
        *,
        provider: str,
        model: str,
        sample_rate: int,
        encoding: str,
    ) -> str:
        session_id = str(uuid.uuid4())
        payload = {
            "session_id": session_id,
            "provider": provider,
            "model": model,
            "status": "active",
            "sample_rate": str(sample_rate),
            "encoding": encoding,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "packet_seq": "0",
            "audio_seconds": "0.0",
        }
        key = self._key(session_id)
        await self._r.hset(key, mapping=payload)
        await self._r.expire(key, settings.session_ttl)
        return session_id

    async def get(self, session_id: str) -> dict | None:
        raw = await self._r.hgetall(self._key(session_id))
        if not raw:
            return None
        return {k.decode(): v.decode() for k, v in raw.items()}

    async def set_status(self, session_id: str, status: str) -> None:
        await self._r.hset(self._key(session_id), "status", status)

    async def close(self, session_id: str) -> None:
        await self._r.hset(self._key(session_id), "status", "closed")
        # Let the TTL clean the key naturally; don't delete immediately so
        # a racing read on close can still see the final state.

    # ------------------------------------------------------------------
    # Per-packet accounting
    # ------------------------------------------------------------------
    async def increment_seq(self, session_id: str) -> int:
        return int(await self._r.hincrby(self._key(session_id), "packet_seq", 1))

    async def add_audio_seconds(self, session_id: str, seconds: float) -> None:
        await self._r.hincrbyfloat(self._key(session_id), "audio_seconds", seconds)
