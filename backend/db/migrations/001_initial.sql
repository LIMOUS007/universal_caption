-- Requires the pgcrypto extension for gen_random_uuid() on Postgres < 13.
-- On Postgres 13+ gen_random_uuid() is built-in, but the extension is harmless.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -------------------------------------------------------------------------
-- Sessions
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transcription_sessions (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID,
    provider      TEXT        NOT NULL,
    model         TEXT        NOT NULL,
    status        TEXT        NOT NULL
                              CHECK (status IN ('active', 'completed', 'error')),
    sample_rate   INT,
    encoding      TEXT,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at      TIMESTAMPTZ,
    audio_seconds NUMERIC     NOT NULL DEFAULT 0,
    error_code    TEXT,
    error_message TEXT
);

-- -------------------------------------------------------------------------
-- Transcript segments (one row per is_final=true chunk)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transcript_segments (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID        NOT NULL
                           REFERENCES transcription_sessions(id)
                           ON DELETE CASCADE,
    start_ms   INT,
    end_ms     INT,
    text       TEXT        NOT NULL,
    confidence NUMERIC,
    is_final   BOOLEAN     NOT NULL DEFAULT true,
    speaker    TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_segments_session_id
    ON transcript_segments (session_id);

-- -------------------------------------------------------------------------
-- Usage / billing events
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usage_events (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID,
    session_id         UUID
                       REFERENCES transcription_sessions(id)
                       ON DELETE CASCADE,
    provider           TEXT,
    audio_seconds      NUMERIC,
    estimated_cost_usd NUMERIC,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
