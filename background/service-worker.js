console.log('[UC] service-worker: loaded');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let _activeTabId = null;
let _ws          = null;
let _isPinned    = false;

// Keep pin state in sync so deliverCaptionToTab knows whether to broadcast.
chrome.storage.local.get('overlayPinned', ({ overlayPinned }) => { _isPinned = !!overlayPinned; });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'overlayPinned' in changes) _isPinned = !!changes.overlayPinned.newValue;
});

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

  // Single-session enforcement — stop existing session before starting new one
  if (_activeTabId && _activeTabId !== tabId) {
    console.log('[UC] service-worker: switching session from tab', _activeTabId, 'to', tabId);
    deliverCaptionToTab('Switching source…');
    await handleStop();
    // Signal popup on new tab to show the switch notice
    await chrome.storage.local.set({ statusMessage: 'Switched caption source to this tab' });
  }

  _activeTabId = tabId;

  // Store tab title (truncated to 30 chars) for popup display
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const title = (tab?.title ?? 'this tab').slice(0, 30);
  await chrome.storage.local.set({ captioningTabTitle: title });

  // 1. Establish the persistent WebSocket connection to FastAPI
  const baseUrl = config.backendUrl || 'ws://localhost:8000';
  _ws = new WebSocket(`${baseUrl}/ws/transcribe`);

  _ws.onopen = () => {
    console.log('[UC] service-worker: WebSocket connected');
    chrome.storage.local.set({ wsStatus: 'connected' });

    // Handshake: match the exact payload the python backend expects
    _ws.send(JSON.stringify({
      type:        'session_start',
      provider:    config.provider || 'openai_chunked',
      api_key:     config.apiKey || '',
      model:       config.model || 'whisper-1',
      sample_rate: 16000,
      encoding:    'pcm_f32le',
    }));
  };

  _ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'transcript_delta' || data.type === 'transcript') {
        if (data.text) {
          const t4 = Date.now();
          console.log(`[UC LAT] T4 transcript_received t=${t4} text="${data.text.slice(0, 40)}"`);
          deliverCaptionToTab(data.text);
        }
      } else if (data.type === 'error') {
        console.error('[UC] Backend returned error:', data.message);
        chrome.storage.local.set({ wsStatus: 'error', wsError: data.message || 'Unknown error' });
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

  // 2. Spin up the offscreen document to capture audio.
  // If anything here fails the WebSocket is already open — clean it up.
  try {
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
  } catch (err) {
    await handleStop();
    throw err;
  }

  await chrome.storage.local.set({ capturing: true });
}

// ---------------------------------------------------------------------------
// Stop Pipeline
// ---------------------------------------------------------------------------
async function handleStop() {
  console.log('[UC] service-worker: handleStop()');

  // Gracefully terminate the WebSocket session
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify({ type: 'session_end' }));
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
  await chrome.storage.local.set({
    wsStatus:           'disconnected',
    wsError:            null,
    captioningTabTitle: null,
    capturing:          false,
    overlayPinned:      false,
    overlayPosition:    null,
  });
  console.log('[UC] service-worker: offscreen document closed');
}

// ---------------------------------------------------------------------------
// Delivery helper
// ---------------------------------------------------------------------------
async function deliverCaptionToTab(text) {
  if (!_activeTabId) return;

  if (_isPinned) {
    // Broadcast to all normal tabs; content script ignores if it has no overlay.
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    const ids  = new Set(tabs.map(t => t.id));
    ids.add(_activeTabId); // ensure capture tab is always included
    for (const id of ids) {
      chrome.tabs.sendMessage(id, { action: 'show-caption', text }).catch(() => {});
    }
    return;
  }

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
      if (_ws && _ws.readyState === WebSocket.OPEN) {
        const float32Array = new Float32Array(message.audioData);
        const t3 = Date.now();
        console.log(`[UC LAT] T3 sw_received_and_forwarding t=${t3} (+${t3 - (message._t2 || t3)}ms since T2)`);
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

// ---------------------------------------------------------------------------
// Keyboard shortcut — Alt+Shift+C toggles captions on the active tab
// ---------------------------------------------------------------------------
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-captions') return;
  const data = await chrome.storage.local.get(
    ['capturing', 'apiKey', 'backendUrl', 'provider', 'language']
  );
  if (data.capturing) {
    await handleStop().catch(console.error);
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    await handleStart(tab.id, {
      provider:   data.provider   || 'openai_chunked',
      apiKey:     data.apiKey     || '',
      backendUrl: data.backendUrl || 'ws://localhost:8000',
      model:      'whisper-1',
      language:   data.language   || undefined,
    }).catch(console.error);
  }
});
