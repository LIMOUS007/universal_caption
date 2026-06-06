# Universal Captions

Real-time speech-to-text captions overlaid on any Chrome tab — YouTube, Google Meet, Zoom, podcasts, lectures, anything with audio.

---

## What you need before starting

- **A computer running Windows, Mac, or Linux**
- **Google Chrome** (or any Chromium-based browser like Edge, Brave)
- **Docker Desktop** — this runs the backend server that does the transcription
  - [Download Docker Desktop for Windows/Mac](https://www.docker.com/products/docker-desktop/)
  - Linux: follow the [Docker Engine install guide](https://docs.docker.com/engine/install/)
- **An OpenAI API key** — used for Whisper transcription
  - Get one at [platform.openai.com/api-keys](https://platform.openai.com/api-keys) (requires a free OpenAI account)

---

## Setup — step by step

### Step 1 — Download this repository

**Option A: with Git**
```bash
git clone https://github.com/LIMOUS007/universal_caption.git
cd universal_caption
```

**Option B: without Git**
- Click the green **Code** button on this GitHub page → **Download ZIP**
- Unzip it somewhere easy to find (e.g. your Desktop)

---

### Step 2 — Start the backend server

The backend handles audio transcription. You need to start it once before using the extension.

**Make sure Docker Desktop is open and running first.**

Then open a terminal in the repository folder and run:

**Mac / Linux:**
```bash
cp backend/.env.example backend/.env
docker-compose up --build
```

**Windows (Command Prompt):**
```cmd
copy backend\.env.example backend\.env
docker-compose up --build
```

**Windows (PowerShell):**
```powershell
Copy-Item backend\.env.example backend\.env
docker-compose up --build
```

The first run downloads dependencies and may take a few minutes. When you see a line like `Uvicorn running on http://0.0.0.0:8000`, the backend is ready.

> **Every time you want to use the extension**, open Docker Desktop and run `docker-compose up` in the repository folder. You can stop it with `Ctrl+C`.

---

### Step 3 — Load the extension in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** using the toggle in the top-right corner
3. Click **Load unpacked**
4. Select the repository root folder (the one containing `manifest.json`)
5. The Universal Captions icon will appear in your Chrome toolbar

> If you don't see the icon, click the puzzle-piece icon in the toolbar and pin Universal Captions.

---

### Step 4 — Add your API key

1. Click the Universal Captions icon in the toolbar
2. Paste your OpenAI API key into the **API Key** field
3. Choose a **Language** or leave it on **Auto-detect**
4. Leave **Backend URL** as `ws://localhost:8000` (only change this if you're running the backend on a different machine)

Your key is only sent to your own local backend — it is never stored or shared.

---

### Step 5 — Start captions

1. Go to any tab that's playing audio (YouTube, a video call, a podcast, etc.)
2. Click **Start Captions** in the popup, or press `Alt+Shift+C`
3. The status dot turns **green** when connected
4. Captions appear as a floating overlay on the page within ~2 seconds

---

## Overlay controls

| Action | What it does |
|---|---|
| Drag the caption box | Move it anywhere on the screen |
| Drag the left or right edge | Resize the width |
| Click 📌 (pin) | Keep the overlay visible across all tabs |
| Click × (close) | Stop captions and dismiss the overlay |
| `Alt+Shift+C` | Toggle captions without opening the popup |

Font size, background opacity, and text opacity are all adjustable from the popup.

---

## Troubleshooting

**"Cannot connect to backend" / status dot stays red**
- Make sure Docker Desktop is running
- Make sure you ran `docker-compose up` and saw the `Uvicorn running` message
- Check that nothing else is using port 8000

**No captions appear even though status is green**
- Check that the tab is actually playing audio (not muted)
- Try stopping and restarting captions
- Make sure your OpenAI API key is correct and has credits

**`docker-compose` command not found**
- Make sure Docker Desktop finished installing and you restarted your terminal after installation

**Extension not showing up after Load unpacked**
- Make sure you selected the root folder of the repository (the one that contains `manifest.json`), not a subfolder

---

## How it works

The extension captures tab audio via Chrome's `tabCapture` API, extracts 16 kHz PCM audio frames using an `AudioWorkletNode`, and streams them over a WebSocket to the local FastAPI backend. The backend sends chunks to OpenAI Whisper and streams transcripts back to the extension, which displays them in a Shadow DOM overlay injected into the page.

## Tech stack

| Layer | Technology |
|---|---|
| Extension | Chrome Manifest V3 |
| Audio capture | `chrome.tabCapture` + Web Audio API |
| Transcription | OpenAI Whisper (`whisper-1`) |
| Backend | FastAPI + WebSocket |
| Storage | PostgreSQL + Redis (via Docker) |

## Project structure

```
├── background/      # Service worker — WebSocket, session control, keepalive
├── content/         # Caption overlay injected into pages (Shadow DOM)
├── offscreen/       # Audio capture & PCM extraction (AudioWorklet)
├── popup/           # Extension popup UI
├── backend/         # FastAPI transcription server
├── manifest.json
└── docker-compose.yml
```
