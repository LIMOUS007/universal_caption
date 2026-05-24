# Universal Captions

Real-time speech-to-text captions overlaid on any Chrome tab.

## How it works

Universal Captions captures the audio from any active browser tab using the Chrome `tabCapture` API, routes it through an offscreen document where a Web Audio `AudioWorkletNode` extracts raw PCM frames, and streams those frames to the Groq Whisper API for transcription. The resulting text is injected back into the page as a floating caption overlay via a content script. The service worker stays alive between chunks using a `chrome.alarms` keepalive, so long sessions don't drop mid-sentence.

## Setup

### 1. Install the extension in Chrome

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `universal_caption` folder.
5. The Universal Captions icon will appear in your toolbar.

### 2. Add your Groq API key

1. Click the Universal Captions toolbar icon to open the popup.
2. Paste your [Groq API key](https://console.groq.com/keys) into the API key field.
3. The key is stored locally via `chrome.storage.local` and never leaves your browser except in direct requests to the Groq API.

## Current status

**Phase 2 complete — audio capture working.**

The full pipeline from tab audio → PCM extraction → offscreen AudioWorklet is functional. Float32 PCM chunks are flowing and logged to the DevTools console. Groq Whisper integration and caption rendering are next.

## Tech stack

| Layer | Technology |
|---|---|
| Extension platform | Chrome Extension Manifest V3 |
| Audio capture | `chrome.tabCapture` + Web Audio API |
| PCM extraction | `AudioWorkletNode` (16 kHz, Float32) |
| Transcription | Groq Whisper (`whisper-large-v3-turbo`) |
| Overlay rendering | Content script + injected DOM |

## Roadmap

### V1
- [ ] Groq Whisper API integration (streaming PCM → transcript chunks)
- [ ] Caption overlay rendered on the active tab
- [ ] API key input in the popup
- [ ] Start/Stop reliably persisted across popup open/close
- [ ] Basic overlay styling (position, font size, background opacity)

### V2
- [ ] Language auto-detection and manual language selector
- [ ] Speaker diarisation (distinguish multiple speakers)
- [ ] Export transcript as `.txt` or `.srt` file
- [ ] Caption history panel in the popup
- [ ] Configurable overlay position (top / bottom / sides)
- [ ] Support for video-call tabs (Meet, Zoom web, Teams)
