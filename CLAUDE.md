# Universal Captions — Claude Code Guide

## Project layout

```
background/service-worker.js   WebSocket client, session control, chrome.alarms keepalive
content/caption-overlay.js     Shadow DOM overlay injected into pages; drag/resize/pin/close
offscreen/audio-processor.js   AudioWorklet: 16kHz PCM Float32, 16k-sample chunks, silence filter
offscreen/offscreen-main.js    tabCapture → AudioContext setup, RMS filtering, forwards chunks
popup/popup.html + popup.js    Extension popup: config, start/stop, status, overlay preview
pip/pip-window.html            Legacy PiP window (unused — overlay replaced it)
backend/                       FastAPI + WebSocket transcription server
```

## Important constraints

- **Do not touch the backend, Docker, WebSocket protocol, or audio pipeline** unless the task is explicitly about those. The display layer (overlay, popup, service-worker session logic) is the active area.
- The overlay uses **Shadow DOM** — not PiP. `pip-window.html` is legacy.
- API key flows **client → server per session** in the `session_start` WS message. It is never stored server-side.

## Running the backend

```bash
docker-compose up --build   # starts Postgres, Redis, FastAPI at :8000
```

Or without Docker: `cd backend && uv sync && uvicorn main:app --reload`

## Chrome extension

Load unpacked from repo root at `chrome://extensions`. Reload after any JS/HTML change.

## Providers

| ID | Model | Notes |
|---|---|---|
| `openai_chunked` | `whisper-1` | default; 1s chunks; reliable |
| `openai_realtime` | `gpt-4o-transcribe` | streaming; lower latency; higher cost |
| `local_whisper` | faster-whisper | stub only — not implemented |

## Chrome storage keys (runtime state)

`capturing`, `wsStatus`, `overlayPinned`, `overlayConfig`, `overlayPosition`, `captioningTabTitle`, `statusMessage`, `previewActive`
