console.log('[UC] service-worker: loaded');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let _activeTabId = null;
let _ws          = null;

// ---------------------------------------------------------------------------
// Keepalive — prevents the service worker from sleeping mid-session.
// Chrome clamps periodInMinutes to ≥ 30 s in production; fine for keepalive.
// ---------------------------------------------------------------------------
chrome.alarms.create('keepalive', { periodInMinutes: 1 / 3 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    console.log('[UC] service-worker: keepalive', new Date().toISOString());
  }
});

// ---------------------------------------------------------------------------
// Offscreen document helpers
// ---------------------------------------------------------------------------
const OFFSCREEN_URL = chrome.runtime.getURL('offscreen/offscreen.html');

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [OFFSCREEN_URL],
  });
  if (contexts.length > 0) return;
  console.log('[UC] service-worker: creating offscreen document');
  await chrome.offscreen.createDocument({
    url:           OFFSCREEN_URL,
    reasons:       ['USER_MEDIA'],
    justification: 'Capture tab audio for live transcription',
  });
}

// ---------------------------------------------------------------------------
// Start Pipeline
// ---------------------------------------------------------------------------
async function handleStart(tabId, config) {
  console.log('[UC] service-worker: handleStart() tabId =', tabId);
  _activeTabId = tabId;

  // 1. Establish the persistent WebSocket connection to FastAPI
  const baseUrl = config.backendUrl || 'ws://localhost:8000';
  _ws = new WebSocket(`${baseUrl}/ws/transcribe`);

  _ws.onopen = () => {
    console.log('[UC] service-worker: WebSocket connected');
    chrome.storage.local.set({ wsStatus: 'connected' });
    
    // Handshake: Match the exact payload your python backend expects
    _ws.send(JSON.stringify({
      type:        "session_start",
      provider:    config.provider || "openai_chunked",
      api_key:     config.groqApiKey || "",
      model:       config.model || "whisper-1",
      sample_rate: 16000,
      encoding:    "pcm_f32le"
    }));
  };

  _ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === 'transcript_delta' || data.type === 'transcript') {
        if (data.text) deliverCaptionToTab(data.text);
      } else if (data.type === 'error') {
        console.error('[UC] Backend returned error:', data.message);
      }
    } catch (e) {
      console.error('[UC] Failed to parse WS message:', e);
    }
  };

  _ws.onerror = (err) => {
    console.error('[UC] WebSocket Error:', err);
    chrome.storage.local.set({ wsStatus: 'error' });
  };

  _ws.onclose = () => {
    console.log('[UC] service-worker: WebSocket closed');
    chrome.storage.local.set({ wsStatus: 'disconnected' });
  };

  // 2. Spin up the offscreen document to capture audio
  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(id);
    });
  });
  console.log('[UC] service-worker: got streamId', streamId);

  await ensureOffscreenDocument();

  const response = await chrome.runtime.sendMessage({
    action: 'init-stream',
    streamId,
    config,
  });
  
  if (!response?.ok) {
    throw new Error(response?.error ?? 'offscreen init failed');
  }
}

// ---------------------------------------------------------------------------
// Stop Pipeline
// ---------------------------------------------------------------------------
async function handleStop() {
  console.log('[UC] service-worker: handleStop()');

  // Gracefully terminate the WebSocket session
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify({ type: "session_end" }));
    _ws.close();
  }
  _ws = null;
  _activeTabId = null;

  try {
    await chrome.runtime.sendMessage({ action: 'stop-stream' });
  } catch (_) {
    // offscreen doc may already be gone
  }

  await chrome.offscreen.closeDocument().catch(() => {});
  await chrome.storage.local.set({ wsStatus: 'disconnected' });
  console.log('[UC] service-worker: offscreen document closed');
}

// ---------------------------------------------------------------------------
// Delivery helper
// ---------------------------------------------------------------------------
async function deliverCaptionToTab(text) {
  if (!_activeTabId) return;

  try {
    await chrome.tabs.sendMessage(_activeTabId, { action: 'show-caption', text });
  } catch (_) {
    // Content script context was invalidated (e.g. navigation) — re-inject and retry once
    try {
      await chrome.scripting.executeScript({
        target: { tabId: _activeTabId },
        files:  ['content/caption-overlay.js'],
      });
      await chrome.tabs.sendMessage(_activeTabId, { action: 'show-caption', text });
    } catch (err) {
      console.warn('[UC] service-worker: could not deliver caption —', err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'start':
      handleStart(message.tabId, message.config)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          console.error('[UC] service-worker: start error', err);
          sendResponse({ ok: false, error: err.message });
        });
      return true;

    case 'stop':
      handleStop()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          console.error('[UC] service-worker: stop error', err);
          sendResponse({ ok: false, error: err.message });
        });
      return true;

    case 'audio-stream-data':
      // The offscreen document passes standard arrays across the message boundary.
      // We convert it back to a Float32Array and send the raw binary buffer directly
      // into the FastAPI websocket connection.
      if (_ws && _ws.readyState === WebSocket.OPEN) {
        const float32Array = new Float32Array(message.audioData);
        _ws.send(float32Array.buffer); 
      }
      break;

    case 'connection-status':
      // Persist for popup to read; popup also listens via storage.onChanged
      chrome.storage.local.set({ wsStatus: message.status });
      break;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[UC] service-worker: installed/updated');
});