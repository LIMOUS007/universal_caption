# Universal Captions

Real-time speech-to-text captions overlaid on any Chrome tab.

## How it works

Universal Captions captures audio from any active browser tab using the Chrome `tabCapture` API, routes it through an offscreen document where an `AudioWorkletNode` extracts 16 kHz PCM frames, and streams those frames over a WebSocket to a FastAPI backend. The backend transcribes the audio using OpenAI Whisper and returns transcript text to the extension. A content script injects the captions into the page as a draggable Shadow DOM overlay that is isolated from the host page's CSS.

The service worker stays alive between chunks using `chrome.alarms`, so long sessions don't drop mid-sentence.

## Features

- **Live captions on any tab** — works on YouTube, Google Meet, Zoom web, podcasts, lectures, or any audio-playing page
- **Draggable, resizable overlay** — reposition and resize the caption box; position is saved across sessions
- **Pin mode** — lock the overlay to stay visible across all tabs simultaneously
- **Language selection** — 16 languages supported; auto-detects by default
- **Silent-frame filtering** — RMS-based silence detection skips quiet chunks to reduce API overhead
- **Single-session enforcement** — switching to a new tab automatically stops the previous session with a brief on-screen notice
- **Overlay appearance controls** — font size (0–500px), background opacity, and text opacity adjustable from the popup
- **Keyboard shortcut** — `Alt+Shift+C` toggles captions from anywhere without opening the popup

## Setup

### 1. Install the extension

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the repository root folder.
5. The Universal Captions icon will appear in your toolbar.

### 2. Start the backend

The extension needs a running backend to transcribe audio.

```bash
# Copy the env file (no changes needed — API key is entered in the popup, not here)
cp backend/.env.example backend/.env

# Start with Docker (recommended)
docker-compose up --build
```

The API will be available at `http://localhost:8000`. See [backend/README.md](backend/README.md) for non-Docker setup.

### 3. Configure the popup

1. Click the Universal Captions toolbar icon.
2. Paste your [OpenAI API key](https://platform.openai.com/api-keys) into the **API Key** field.
3. Select a **Language** (or leave on Auto-detect).
4. Adjust font size and opacity if desired.
5. Backend URL defaults to `ws://localhost:8000` — change it under **Advanced** only if your backend runs elsewhere.

### 4. Start captions

1. Navigate to any tab with audio.
2. Click **Start Captions** in the popup, or press `Alt+Shift+C`.
3. The status dot turns green when connected. Captions will appear in the floating overlay within ~2 seconds.

## Tech stack

| Layer | Technology |
|---|---|
| Extension platform | Chrome Extension Manifest V3 |
| Audio capture | `chrome.tabCapture` + Web Audio API |
| PCM extraction | `AudioWorkletNode` (16 kHz, Float32) |
| Transcription | OpenAI Whisper (`whisper-1`) |
| Caption delivery | Content script + Shadow DOM overlay |
| Backend | FastAPI + WebSocket |
| Storage | PostgreSQL + Redis |

## Overlay controls

| Control | Action |
|---|---|
| Drag caption box | Reposition (saved to storage) |
| Drag right/left edge | Resize width (up to full screen) |
| Pin button (📌) | Keep overlay visible across all tabs |
| Close button (×) | Stop session and dismiss overlay |
| `Alt+Shift+C` | Toggle captions from anywhere |

## Project structure

```
├── background/          # Chrome service worker — WebSocket, session control, keepalive
├── content/             # Caption overlay injected into pages (Shadow DOM)
├── offscreen/           # Audio capture & PCM extraction (AudioWorklet)
├── popup/               # Extension popup UI
├── backend/             # FastAPI transcription server
│   ├── providers/       # openai_chunked, local_whisper (stub — v1.5)
│   ├── endpoints/       # WebSocket route
│   └── db/              # Postgres schema and queries
├── manifest.json
└── docker-compose.yml
```
