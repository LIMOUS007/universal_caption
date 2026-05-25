console.log('[UC] service-worker: loaded');

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
// Track the tab being captured so we can route transcripts back to it
// ---------------------------------------------------------------------------
let _activeTabId = null;

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
// Start
// ---------------------------------------------------------------------------
async function handleStart(tabId, config) {
  console.log('[UC] service-worker: handleStart() tabId =', tabId);
  _activeTabId = tabId;

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
  console.log('[UC] service-worker: init-stream response', response);
  if (!response?.ok) {
    throw new Error(response?.error ?? 'offscreen init failed');
  }
}

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------
async function handleStop() {
  console.log('[UC] service-worker: handleStop()');
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
// Message router
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[UC] service-worker: message', message.action, 'from', sender?.url ?? 'unknown');

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

    case 'transcribe-chunk':
      handleTranscribeChunk(message.audioArray, message.mimeType);
      break;

    case 'connection-status':
      // Persist for popup to read; popup also listens via storage.onChanged
      chrome.storage.local.set({ wsStatus: message.status });
      break;
  }
});

// ---------------------------------------------------------------------------
// Groq Whisper transcription
// ---------------------------------------------------------------------------
async function callGroqWhisper(audioArray, mimeType) {
  const { groqApiKey } = await chrome.storage.local.get('groqApiKey');
  if (!groqApiKey) throw new Error('No Groq API key set');

  console.log('[UC] service-worker: audioArray length sent to Groq:', audioArray.length);

  const uint8Array = new Uint8Array(audioArray);
  const blob = new Blob([uint8Array], { type: mimeType || 'audio/webm;codecs=opus' });
  const file = new File([blob], 'audio.webm', { type: 'audio/webm' });
  const body = new FormData();
  body.append('file', file);
  body.append('model', 'whisper-large-v3-turbo');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${groqApiKey}` },
    body,
  });

  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);

  const json = await res.json();
  return (json.text ?? '').trim();
}

async function handleTranscribeChunk(audioArray, mimeType) {
  let text;
  try {
    text = await callGroqWhisper(audioArray, mimeType);
  } catch (err) {
    console.warn('[UC] service-worker: Groq attempt 1 failed, retrying in 1 s —', err.message);
    await new Promise((r) => setTimeout(r, 1000));
    try {
      text = await callGroqWhisper(audioArray, mimeType);
    } catch (err2) {
      console.warn('[UC] service-worker: Groq attempt 2 failed, dropping chunk —', err2.message);
      return;
    }
  }

  if (!text || !_activeTabId) return;

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

chrome.runtime.onInstalled.addListener(() => {
  console.log('[UC] service-worker: installed/updated');
});
