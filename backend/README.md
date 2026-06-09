# Universal Captions — Backend

FastAPI WebSocket server that receives raw PCM audio from the Chrome extension and returns live transcripts via the configured provider (OpenAI Whisper, Groq, or Deepgram).

---

## Prerequisites

- **Docker + Docker Compose** (recommended) — or Python 3.13 + [uv](https://docs.astral.sh/uv/)
- PostgreSQL 15+ and Redis 7+ (both included in the Docker Compose stack)

---

## Quick start (Docker)

```bash
# from the repository root:
cp backend/.env.example backend/.env
docker-compose up --build
```

- API health check: `http://localhost:8000/`
- WebSocket endpoint: `ws://localhost:8000/ws/transcribe`

---

## Running without Docker

```bash
cd backend

# Install dependencies
uv sync          # or: pip install -e .

# Start Postgres and Redis separately, then:
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://uc:uc@localhost:5432/universal_captions` | asyncpg-compatible Postgres URL |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `SESSION_TTL` | `14400` | Redis session TTL in seconds (4 hours) |

API keys are passed per-session from the extension popup and are never stored server-side.

Copy `.env.example` to `.env` before starting.

---

## WebSocket protocol

```
Client → Server
  1. TEXT   {"type":"session_start","provider":"openai_chunked","api_key":"...","model":"whisper-1","sample_rate":16000,"encoding":"pcm_f32le","language":"en"}
  2. BINARY <Float32-LE PCM frames>   (repeated until session ends)
  3. TEXT   {"type":"session_end"}

Server → Client
  1. {"type":"session_started","session_id":"<uuid>"}
  2. {"type":"transcript","text":"...","is_final":true}
  3. {"type":"error","message":"..."}
  4. {"type":"session_ended","session_id":"<uuid>"}
```

`language` is optional — omit for auto-detect. The `session_started` message confirms the provider was initialised with a valid key before any audio is sent.

---

## Providers

| `provider` value | Model | Mechanism |
|---|---|---|
| `openai_chunked` | `whisper-1` | Buffers 1.5 s of Float32 PCM → WAV in-memory → `POST /v1/audio/transcriptions` |
| `groq` | `whisper-large-v3-turbo` | Same as `openai_chunked` with `base_url` overridden to Groq's endpoint |
| `deepgram` | `nova-2` | Buffers 1.5 s of Float32 PCM → WAV → `POST https://api.deepgram.com/v1/listen` |
| `local_whisper` | *(stub)* | Not implemented — raises `NotImplementedError` |

API calls for each window are fired as background tasks so the next buffer starts filling immediately, keeping caption latency independent of API round-trip time.

---

## Running tests

```bash
cd backend
uv run pytest tests/ -v
```
