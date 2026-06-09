# Universal Captions

Live subtitles on any Chrome tab — YouTube, Zoom, podcasts, lectures, anything with audio. Captions float on top of the page so you can read while you watch.

---

## Before you start — what you'll need

You need **3 things** before following the steps below:

### 1. Google Chrome
Most people already have this. If not, [download it here](https://www.google.com/chrome/).

### 2. Docker Desktop
This is a free app that runs the caption server in the background. Think of it like a small engine that does the heavy lifting.

- **Windows or Mac:** [Download Docker Desktop](https://www.docker.com/products/docker-desktop/) → install it like any normal app → open it
- **Linux:** [Install guide](https://docs.docker.com/engine/install/)

> After installing, always **open Docker Desktop first** before using the extension. It needs to be running in the background.

### 3. A free API key (pick one)

An API key is like a password that gives the app permission to use a transcription service. Pick whichever is easiest:

| Service | Cost | How to get the key |
|---|---|---|
| **Groq** (recommended for beginners) | Free | Go to [console.groq.com/keys](https://console.groq.com/keys) → sign up → click "Create API Key" → copy it |
| **Deepgram** | Free $200 credit | Go to [console.deepgram.com](https://console.deepgram.com) → sign up → go to API Keys → create one |
| **OpenAI** | Pay per use | Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys) → sign up → create a key |

**Groq is free and fast — start there if you're unsure.**

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

### Step 5 — Add your API key

1. Click the Universal Captions icon in the toolbar
2. Click the chip for the service you signed up for — **OpenAI**, **Groq**, or **Deepgram**
3. Paste your API key into the box
4. Leave everything else as-is

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

## Something not working?

**The status dot stays red or shows "Connection error"**
→ Docker Desktop is probably not running. Open it and make sure the engine is started, then run `docker-compose up` again in the terminal.

**"Enter a key to start captions"**
→ You need to paste your API key first (Step 5 above).

**Status is green but no captions appear**
→ Check that the tab's audio isn't muted. Try stopping and starting captions again.

**"401" or "invalid key" error**
→ The API key was rejected. Double-check you copied the full key without any extra spaces, and that you're using the right provider chip for that key.

**`docker-compose` command not found**
→ Docker Desktop may not have finished installing. Restart your terminal (close it and open a new one) and try again.

**Extension doesn't appear after "Load unpacked"**
→ Make sure you selected the right folder — it should be the one that has `manifest.json` directly inside it, not a subfolder.

**Alt+Shift+C does nothing**
→ Make sure you've entered an API key first. The shortcut won't work if no key is configured.

---

## How it works (optional reading)

The extension captures audio from the tab using Chrome's built-in audio tools. It converts the audio into small chunks and sends them over a local connection to the backend server running on your computer. The server sends those chunks to the transcription service (Groq, Deepgram, or OpenAI), gets back the text, and displays it on the page. Your API key is only used on your own machine — it's never stored on any external server.
