# Universal Captions — Backend

FastAPI WebSocket server that receives raw PCM audio from the Chrome extension and returns transcripts via OpenAI Whisper (chunked) or the OpenAI Realtime API.

## Prerequisites

- Docker + Docker Compose **or** Python 3.13 + [uv](https://docs.astral.sh/uv/)
- PostgreSQL 15+ and Redis 7+ (included in the Docker Compose stack)

## Quick Start (Docker)

```bash
# 1. Copy and fill in the env file
cp .env.example .env
# Edit .env — set OPENAI_API_KEY (or leave blank and enter it in the extension popup)

# 2. Start Postgres, Redis, and the API server
docker-compose up --build

# API running at http://localhost:8000
# WebSocket: ws://localhost:8000/ws/transcribe
```

## Running Without Docker

```bash
cd backend

# Install dependencies
uv sync          # or: pip install -e .

# Start Postgres and Redis separately (e.g. via Docker or local installs), then:
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://uc:uc@localhost:5432/universal_captions` | asyncpg-compatible Postgres URL |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `SESSION_TTL` | `14400` | Redis session TTL in seconds (default 4 hours) |

The OpenAI API key is supplied per-session from the extension popup and is never stored on the server.

Copy `.env.example` to `.env` and set values before starting.

## Connecting the Extension

1. Load the extension in Chrome (`chrome://extensions` → Load unpacked → select repo root).
2. Click the Universal Captions toolbar icon.
3. Set **Backend URL** to `ws://localhost:8000`.
4. Select a **Provider** and paste your **OpenAI API key**.
5. Click **Start Captions** on any tab with audio.

## WebSocket Protocol

```
Client → Server:
  1. TEXT   {"type":"session_start","provider":"openai_chunked","api_key":"sk-...","model":"whisper-1","sample_rate":16000,"encoding":"pcm_f32le"}
  2. BINARY <Float32-LE PCM frames>  (repeated)
  3. TEXT   {"type":"session_end"}

Server → Client:
  1. {"type":"transcript","text":"..."}               — complete phrase (chunked provider)
  2. {"type":"transcript_delta","text":"..."}         — incremental word (realtime provider)
  3. {"type":"error","message":"..."}
```

## Providers

| Value | Model | Description |
|---|---|---|
| `openai_chunked` | `whisper-1` | Buffers ~1s of Float32 PCM, converts to WAV in-memory, sends to `POST /v1/audio/transcriptions`. Reliable, slight latency. |
| `openai_realtime` | `gpt-4o-transcribe` | Streams Float32→Int16 PCM to OpenAI Realtime API with server-side VAD. Lower latency, higher cost. |
| `local_whisper` | *(stub)* | Intended for faster-whisper on CPU/GPU. Not yet implemented. |

## Running Tests

```bash
cd backend
uv run pytest tests/ -v
```
