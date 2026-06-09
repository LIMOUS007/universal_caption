# Universal Captions

Live subtitles on any Chrome tab — YouTube, Zoom, podcasts, lectures, anything with audio. Captions float on top of the page so you can read while you watch.

---

## Before you start — what you'll need

You need **2 things** before following the steps below:

### 1. Google Chrome
Most people already have this. If not, [download it here](https://www.google.com/chrome/).

### 2. Docker Desktop
This is a free app that runs the caption server in the background. Think of it like a small engine that does the heavy lifting.

- **Windows or Mac:** [Download Docker Desktop](https://www.docker.com/products/docker-desktop/) → install it like any normal app → open it
- **Linux:** [Install guide](https://docs.docker.com/engine/install/)

> After installing, always **open Docker Desktop first** before using the extension. It needs to be running in the background.

### 3. A transcription provider (pick one)

| Provider | Cost | API Key needed? | Notes |
|---|---|---|---|
| **Groq** | Free | Yes | Fastest cloud option — great for beginners |
| **Deepgram** | Free $200 credit | Yes | High accuracy, low latency |
| **OpenAI** | Pay per use | Yes | Whisper-1 model via OpenAI API |
| **Local Whisper** | Free forever | **No** | Runs on your computer — no internet needed for transcription |

**Not sure which to pick?**
- Want the easiest start → **Groq** (free, no setup beyond the key)
- Want no API key and total privacy → **Local Whisper** (first use downloads ~250 MB, then it's instant)

#### How to get a cloud API key

| Service | Steps |
|---|---|
| **Groq** | Go to [console.groq.com/keys](https://console.groq.com/keys) → sign up → click "Create API Key" → copy it |
| **Deepgram** | Go to [console.deepgram.com](https://console.deepgram.com) → sign up → go to API Keys → create one |
| **OpenAI** | Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys) → sign up → create a key |

> **Local Whisper** — no key required. Skip straight to setup.

---

## Setup (do this once)

### Step 1 — Download this project

**Option A — with Git** (if you have it):
```
git clone https://github.com/LIMOUS007/universal_caption.git
```

**Option B — without Git:**
- Click the green **Code** button at the top of this GitHub page
- Click **Download ZIP**
- Unzip the folder somewhere easy to find (like your Desktop)

---

### Step 2 — Open a terminal in the project folder

A terminal is a text window where you type commands. Here's how to open one inside the project folder:

**Windows:**
- Open the unzipped folder in File Explorer
- Click the address bar at the top (where it shows the folder path)
- Type `cmd` and press Enter — a black terminal window opens in that folder

**Mac:**
- Open the folder in Finder
- Right-click on the folder → **New Terminal at Folder** (or open Terminal from Applications, then drag the folder into it)

---

### Step 3 — Run the backend server

Make sure **Docker Desktop is open** first. Then, in the terminal you just opened, run these two commands one at a time (copy and paste each line, then press Enter):

**Windows:**
```
copy backend\.env.example backend\.env
docker-compose up --build
```

**Mac / Linux:**
```
cp backend/.env.example backend/.env
docker-compose up --build
```

The first time you run this, it will take **2–5 minutes** to download and set things up. That's normal.

When you see a line that says `Uvicorn running on http://0.0.0.0:8000` — you're ready. Leave this window open.

> **Every time you use the extension:** open Docker Desktop, then run `docker-compose up` in the terminal. You can stop it any time with `Ctrl+C`.

---

### Step 4 — Load the extension into Chrome

1. Open Chrome and go to this address: `chrome://extensions`
2. Turn on **Developer mode** — there's a toggle in the top-right corner of the page
3. Click **Load unpacked**
4. Select the folder you downloaded (the one that contains `manifest.json` inside it)
5. The Universal Captions icon will appear in your Chrome toolbar (top-right)

> Can't see the icon? Click the **puzzle piece** icon in the toolbar and pin Universal Captions.

---

### Step 5 — Configure your provider

Click the Universal Captions icon in the toolbar, then pick your provider chip:

**Cloud providers (OpenAI / Groq / Deepgram):**
1. Click the chip for the service you signed up for
2. Paste your API key into the box
3. Leave everything else as-is

**Local Whisper:**
1. Click the **Local** chip
2. The API key field disappears — no key needed
3. That's it. The first time you start captions, the backend will download the Whisper model (~250 MB). This takes about 1–2 minutes on a normal connection. After that first download it's instant every time.

---

### Step 6 — Start captions!

1. Go to any tab with audio (a YouTube video, a meeting, a podcast)
2. Click **Start Captions** in the popup
3. The dot turns **green** = it's working
4. Captions appear as a floating box on the page within a couple of seconds

You can also press **Alt+Shift+C** on your keyboard to turn captions on or off without opening the popup.

---

## Using the caption overlay

Once captions are on, a box appears on the page. Here's what you can do with it:

- **Drag it** anywhere on the screen
- **Drag the left or right edge** to make it wider or narrower
- **Click 📌** to pin it — it stays visible even if you switch tabs
- **Click ✕** to stop captions
- Adjust font size, background brightness, and text brightness from the popup

---

## Choosing a provider — quick comparison

| | Groq | Deepgram | OpenAI | Local Whisper |
|---|---|---|---|---|
| API key required | Yes | Yes | Yes | **No** |
| Works offline | No | No | No | **Yes** |
| Latency | ~0.5 s | ~0.5 s | ~1–2 s | ~0.5–2 s (CPU) |
| Accuracy | Very high | Very high | High | High (`small` model) |
| Cost | Free | Free credit | Per minute | Free |
| Privacy | Cloud | Cloud | Cloud | **Fully local** |

---

## Something not working?

**The status dot stays red or shows "Connection error"**
→ Docker Desktop is probably not running. Open it and make sure the engine is started, then run `docker-compose up` again in the terminal.

**"Enter a key to start captions"**
→ You need to paste your API key first (Step 5 above). If you're using Local Whisper, make sure the **Local** chip is selected — it hides the key field automatically.

**Status is green but no captions appear**
→ Check that the tab's audio isn't muted. Try stopping and starting captions again.

**"401" or "invalid key" error**
→ The API key was rejected. Double-check you copied the full key without any extra spaces, and that you're using the right provider chip for that key.

**Local Whisper — no captions for the first 1–2 minutes**
→ The model is downloading on first use (~250 MB). Watch the Docker terminal window — you'll see download progress. Once it finishes, captions start flowing. It only downloads once.

**Local Whisper — captions are inaccurate or missing words**
→ The `small` model (default) works well for clear speech. Background noise or multiple speakers will reduce accuracy. Try speaking clearly or reducing background audio.

**`docker-compose` command not found**
→ Docker Desktop may not have finished installing. Restart your terminal (close it and open a new one) and try again.

**Extension doesn't appear after "Load unpacked"**
→ Make sure you selected the right folder — it should be the one that has `manifest.json` directly inside it, not a subfolder.

**Alt+Shift+C does nothing**
→ Make sure captions are configured (API key entered, or Local chip selected) and the backend is running.

---

## How it works (optional reading)

The extension captures audio from the tab using Chrome's built-in audio tools. It converts the audio into small 1.5-second chunks and sends them over a local connection to the backend server running on your computer.

**Cloud providers (Groq / Deepgram / OpenAI):** the backend sends each chunk to the cloud transcription API, gets back the text, and displays it on the page. Your API key is sent per-session from the popup — it is never stored on any server.

**Local Whisper:** the backend runs the [faster-whisper](https://github.com/SYSTRAN/faster-whisper) model directly on your CPU. No audio ever leaves your machine. The model (`whisper-small`, ~250 MB) is downloaded from HuggingFace on first use and cached permanently in Docker. After the first download, it loads in a few seconds each time.

---

## Providers at a glance (for developers)

| ID | Backend | Model | Notes |
|---|---|---|---|
| `openai_chunked` | OpenAI API | `whisper-1` | Default cloud provider |
| `groq` | Groq API | `whisper-large-v3-turbo` | Fastest cloud option |
| `deepgram` | Deepgram API | `nova-2` | Best punctuation/formatting |
| `local_whisper` | faster-whisper (CPU) | `whisper-small` | Fully local, no key required |

### Running the backend without Docker

```bash
cd backend
pip install uv
uv sync
uvicorn main:app --reload
```

Requires Postgres and Redis running locally. Set `DATABASE_URL` and `REDIS_URL` in `backend/.env`.

### Project layout

```
background/service-worker.js    WebSocket client, session control, chrome.alarms keepalive
content/caption-overlay.js      Shadow DOM overlay injected into pages; drag/resize/pin/close
offscreen/audio-processor.js    AudioWorklet: 16kHz PCM Float32, 16k-sample chunks
offscreen/offscreen-main.js     tabCapture → AudioContext setup, forwards chunks to SW
popup/popup.html + popup.js     Extension popup: provider chips, config, start/stop, status
backend/                        FastAPI + WebSocket transcription server
backend/providers/              One file per provider: openai_chunked, groq, deepgram, local_whisper
backend/db/                     Postgres session/segment/usage schema + asyncpg queries
```
