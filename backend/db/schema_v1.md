```sql
CREATE TABLE transcription_sessions (
    id UUID PRIMARY KEY,
    user_id UUID,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL,
    sample_rate INT,
    encoding TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    audio_seconds NUMERIC DEFAULT 0,
    error_code TEXT,
    error_message TEXT
);

CREATE TABLE transcript_segments (
    id UUID PRIMARY KEY,
    session_id UUID REFERENCES transcription_sessions(id) ON DELETE CASCADE,
    start_ms INT,
    end_ms INT,
    text TEXT NOT NULL,
    confidence NUMERIC,
    is_final BOOLEAN NOT NULL DEFAULT true,
    speaker TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usage_events (
    id UUID PRIMARY KEY,
    user_id UUID,
    session_id UUID REFERENCES transcription_sessions(id) ON DELETE CASCADE,
    provider TEXT,
    audio_seconds NUMERIC,
    estimated_cost_usd NUMERIC,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```