# Universal Captions — Backend

FastAPI WebSocket server that receives raw PCM audio from the Chrome extension and returns transcripts. Supports OpenAI Whisper (chunked) and OpenAI Realtime API providers.

## Prerequisites

- Docker + Docker Compose **or** Python 3.13 + [uv](https://docs.astral.sh/uv/)

## Quick Start (Docker)

```bash
# 1. Copy and fill in the env file
cp .env.example .env
# Edit .env — set your OpenAI API key (or leave blank if using the extension UI)

# 2. Start Postgres, Redis, and the API server
docker-compose up --build

# The API is now running at http://localhost:8000
# WebSocket endpoint: ws://localhost:8000/ws/transcribe
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
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://uc:uc@localhost:5432/uc` | asyncpg-compatible Postgres URL |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `SESSION_TTL` | `3600` | Redis session TTL in seconds (optional) |

Copy `.env.example` to `.env` and set values before starting.

## Connecting the Extension

1. Load the extension in Chrome (`chrome://extensions` → Load unpacked → select repo root).
2. Click the Universal Captions toolbar icon.
3. Set **Backend URL** to `ws://localhost:8000`.
4. Set **Provider** to `OpenAI Whisper (chunked)` (default) or `OpenAI Realtime`.
5. Paste your **OpenAI API key** into the API Key field.
6. Click **Start Captions** on any tab with audio.

The status dot turns green when the WebSocket handshake succeeds. Captions appear in the floating Picture-in-Picture window (or as a Shadow DOM overlay if PiP is unavailable).

## WebSocket Protocol

```
Client → Server:
  1. TEXT  {"type":"session_start","provider":"openai_chunked","api_key":"sk-...","model":"whisper-1","sample_rate":16000,"encoding":"pcm_f32le"}
  2. BINARY <Float32-LE PCM frames>  (repeated)
  3. TEXT  {"type":"session_end"}

Server → Client:
  1. {"type":"session_started","session_id":"<uuid>"}
  2. {"type":"transcript","text":"...","is_final":true}
  3. {"type":"transcript_delta","text":"...","is_final":false}  (Realtime provider only)
  4. {"type":"error","message":"..."}
  5. {"type":"session_ended","session_id":"<uuid>"}
```

## Providers

| Value | Description |
|-------|-------------|
| `openai_chunked` | Buffers ~5 s of PCM, sends to `POST /v1/audio/transcriptions` (Whisper). Reliable, slight latency. |
| `openai_realtime` | Streams PCM to OpenAI Realtime API. Lower latency, higher cost. |
