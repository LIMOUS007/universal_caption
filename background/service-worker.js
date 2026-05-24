console.log('[UC] service-worker: loaded');

// ---------------------------------------------------------------------------
// Keepalive — fires every ~20 s to prevent the service worker from sleeping.
// Chrome clamps periodInMinutes to a minimum of 30 s in production builds;
// in an unpacked/dev extension the 20 s value is honoured.
// ---------------------------------------------------------------------------
chrome.alarms.create('keepalive', { periodInMinutes: 1 / 3 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    console.log('[UC] service-worker: keepalive ping', new Date().toISOString());
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
  if (contexts.length > 0) {
    console.log('[UC] service-worker: offscreen document already open');
    return;
  }
  console.log('[UC] service-worker: creating offscreen document');
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Capture tab audio stream for live captioning',
  });
  console.log('[UC] service-worker: offscreen document created');
}

// ---------------------------------------------------------------------------
// Start: obtain a stream ID via tabCapture, then hand it to the offscreen doc
// ---------------------------------------------------------------------------
async function handleStart(tabId) {
  console.log('[UC] service-worker: handleStart(), tabId =', tabId);

  // getMediaStreamId can be called from a service worker without a user gesture.
  // It returns a string ID (NOT a MediaStream) which is safe to postMessage.
  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(id);
      }
    });
  });
  console.log('[UC] service-worker: got streamId', streamId);

  await ensureOffscreenDocument();

  // Forward stream ID — offscreen doc calls getUserMedia with this ID
  const response = await chrome.runtime.sendMessage({
    action: 'init-stream',
    streamId,
  });
  console.log('[UC] service-worker: init-stream response', response);
}

// ---------------------------------------------------------------------------
// Stop: tear down offscreen doc
// ---------------------------------------------------------------------------
async function handleStop() {
  console.log('[UC] service-worker: handleStop()');
  try {
    await chrome.runtime.sendMessage({ action: 'stop-stream' });
  } catch (_) {
    // offscreen doc may already be gone
  }
  await chrome.offscreen.closeDocument().catch(() => {});
  console.log('[UC] service-worker: offscreen document closed');
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[UC] service-worker: message received', message, 'from', sender?.url ?? 'unknown');

  if (message.action === 'start') {
    handleStart(message.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('[UC] service-worker: handleStart error', err);
        sendResponse({ ok: false, error: err.message });
      });
    return true; // keep channel open for async sendResponse
  }

  if (message.action === 'stop') {
    handleStop()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('[UC] service-worker: handleStop error', err);
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  if (message.action === 'transcript') {
    console.log('[UC] service-worker: transcript chunk received', message.text);
    // TODO: forward to active tab's content script via chrome.tabs.sendMessage
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[UC] service-worker: extension installed/updated');
});
