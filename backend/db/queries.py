import uuid

from db.database import get_pool


async def insert_session(
    *,
    session_id: str,
    provider: str,
    model: str,
    sample_rate: int,
    encoding: str,
    user_id: str | None = None,
) -> None:
    await get_pool().execute(
        """
        INSERT INTO transcription_sessions
            (id, user_id, provider, model, status, sample_rate, encoding)
        VALUES ($1, $2, $3, $4, 'active', $5, $6)
        """,
        uuid.UUID(session_id), user_id, provider, model, sample_rate, encoding,
    )


async def close_session(
    session_id: str,
    *,
    error_code: str | None = None,
    error_message: str | None = None,
) -> None:
    status = "error" if error_code else "completed"
    await get_pool().execute(
        """
        UPDATE transcription_sessions
        SET status        = $2,
            ended_at      = now(),
            error_code    = $3,
            error_message = $4
        WHERE id = $1
        """,
        uuid.UUID(session_id), status, error_code, error_message,
    )


async def insert_segment(
    *,
    session_id: str,
    text: str,
    start_ms: int | None,
    end_ms: int | None,
    confidence: float | None,
    is_final: bool,
    speaker: str | None = None,
) -> None:
    await get_pool().execute(
        """
        INSERT INTO transcript_segments
            (id, session_id, start_ms, end_ms, text, confidence, is_final, speaker)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """,
        uuid.uuid4(), uuid.UUID(session_id),
        start_ms, end_ms, text, confidence, is_final, speaker,
    )


async def insert_usage_event(
    *,
    session_id: str,
    provider: str,
    audio_seconds: float,
    user_id: str | None = None,
) -> None:
    await get_pool().execute(
        """
        INSERT INTO usage_events
            (id, user_id, session_id, provider, audio_seconds)
        VALUES ($1, $2, $3, $4, $5)
        """,
        uuid.uuid4(), user_id, uuid.UUID(session_id), provider, audio_seconds,
    )
