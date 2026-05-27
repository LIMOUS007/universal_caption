console.log('[UC] popup: loaded');

const startBtn         = document.getElementById('start-btn');
const stopBtn          = document.getElementById('stop-btn');
const providerEl       = document.getElementById('provider');
const apiKeyEl         = document.getElementById('api-key');
const backendEl        = document.getElementById('backend-url');
const statusDot        = document.getElementById('status-dot');
const statusText       = document.getElementById('status-text');
const captionSource    = document.getElementById('caption-source');
const switchNotice     = document.getElementById('switch-notice');
const fontSizeEl       = document.getElementById('font-size');
const fontSizeValEl    = document.getElementById('font-size-val');
const bgOpacityEl      = document.getElementById('bg-opacity');
const bgOpacityValEl   = document.getElementById('bg-opacity-val');
const textOpacityEl    = document.getElementById('text-opacity');
const textOpacityValEl = document.getElementById('text-opacity-val');

const lockableFields = ['field-provider', 'field-api-key', 'field-backend-url'];

let isCapturing = false;
let _activeTabId = null;

// ---------------------------------------------------------------------------
// Restore persisted config + state
// ---------------------------------------------------------------------------
chrome.storage.local.get(
  ['capturing', 'wsStatus', 'provider', 'apiKey', 'groqApiKey', 'backendUrl', 'overlayConfig',
   'captioningTabTitle', 'statusMessage'],
  (data) => {
    console.log('[UC] popup: restored storage', data);
    isCapturing      = !!data.capturing;
    providerEl.value = data.provider || 'openai_chunked';

    const resolvedApiKey = data.apiKey || data.groqApiKey || '';
    if (data.groqApiKey && !data.apiKey) {
      chrome.storage.local.set({ apiKey: resolvedApiKey });
      chrome.storage.local.remove('groqApiKey');
    }
    apiKeyEl.value  = resolvedApiKey;
    backendEl.value = data.backendUrl || 'ws://localhost:8000';
    updateStatus(data.wsStatus || 'disconnected');
    updateTabTitle(data.captioningTabTitle || null);
    syncButtons();

    const oc  = data.overlayConfig || {};
    const fs  = oc.fontSize    ?? 18;
    const bgo = Math.round((oc.bgOpacity   ?? 0.78) * 100);
    const txo = Math.round((oc.textOpacity ?? 1.0)  * 100);
    fontSizeEl.value             = fs;
    fontSizeValEl.textContent    = fs;
    bgOpacityEl.value            = bgo;
    bgOpacityValEl.textContent   = bgo;
    textOpacityEl.value          = txo;
    textOpacityValEl.textContent = txo;

    if (data.statusMessage) {
      showSwitchNotice();
      chrome.storage.local.remove('statusMessage');
    }

    // Show preview overlay on active tab (if not already capturing)
    if (!isCapturing) {
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (!tab) return;
        _activeTabId = tab.id;
        chrome.tabs.sendMessage(tab.id, {
          action: 'show-preview',
          config: {
            fontSize:    fs,
            bgOpacity:   bgo / 100,
            textOpacity: txo / 100,
          },
        }).catch(() => {});
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Persist config fields on change
// ---------------------------------------------------------------------------
providerEl.addEventListener('change', () =>
  chrome.storage.local.set({ provider: providerEl.value }),
);
apiKeyEl.addEventListener('input', () =>
  chrome.storage.local.set({ apiKey: apiKeyEl.value }),
);
backendEl.addEventListener('input', () =>
  chrome.storage.local.set({ backendUrl: backendEl.value }),
);

// ---------------------------------------------------------------------------
// Listen for status + tab title changes from service worker
// ---------------------------------------------------------------------------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.wsStatus)           updateStatus(changes.wsStatus.newValue);
  if (changes.captioningTabTitle) updateTabTitle(changes.captioningTabTitle.newValue);
  if (changes.statusMessage?.newValue) {
    showSwitchNotice();
    chrome.storage.local.remove('statusMessage');
  }
});

// ---------------------------------------------------------------------------
// Overlay config persistence — storage.onChanged drives the live overlay
// ---------------------------------------------------------------------------
function saveOverlayConfig() {
  chrome.storage.local.set({
    overlayConfig: {
      fontSize:    Number(fontSizeEl.value),
      bgOpacity:   Number(bgOpacityEl.value)   / 100,
      textOpacity: Number(textOpacityEl.value) / 100,
    },
  });
}

fontSizeEl.addEventListener('input', () => {
  fontSizeValEl.textContent = fontSizeEl.value;
  saveOverlayConfig();
});
bgOpacityEl.addEventListener('input', () => {
  bgOpacityValEl.textContent = bgOpacityEl.value;
  saveOverlayConfig();
});
textOpacityEl.addEventListener('input', () => {
  textOpacityValEl.textContent = textOpacityEl.value;
  saveOverlayConfig();
});

// ---------------------------------------------------------------------------
// Start button
// ---------------------------------------------------------------------------
startBtn.addEventListener('click', async () => {
  console.log('[UC] popup: start clicked');
  startBtn.disabled = true;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { syncButtons(); return; }
  _activeTabId = tab.id;
  console.log('[UC] popup: active tab', tab?.id, tab?.url);

  const config = {
    provider:   providerEl.value,
    apiKey:     apiKeyEl.value,
    backendUrl: backendEl.value,
    model:      'whisper-1',
  };

  console.log('[UC] popup: sending start with config', { ...config, apiKey: '***' });
  chrome.runtime.sendMessage({ action: 'start', tabId: tab.id, config }, (response) => {
    console.log('[UC] popup: start response', response);
    if (response?.ok) {
      isCapturing = true;
      // capturing: true triggers the content script to drop the preview class
      chrome.storage.local.set({ capturing: true });
    }
    syncButtons();
  });
});

// ---------------------------------------------------------------------------
// Stop button
// ---------------------------------------------------------------------------
stopBtn.addEventListener('click', async () => {
  console.log('[UC] popup: stop clicked');
  stopBtn.disabled = true;

  chrome.runtime.sendMessage({ action: 'stop' }, (response) => {
    console.log('[UC] popup: stop response', response);
    isCapturing = false;
    // capturing: false triggers all content scripts to remove overlay
    chrome.storage.local.set({ capturing: false });
    syncButtons();
  });
});

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function syncButtons() {
  startBtn.disabled = isCapturing;
  stopBtn.disabled  = !isCapturing;
  lockFields(isCapturing);
}

function lockFields(lock) {
  lockableFields.forEach((id) => {
    const el = document.getElementById(id);
    if (lock) el.classList.add('locked');
    else      el.classList.remove('locked');
  });
}

function updateStatus(status) {
  const labels = {
    connecting:   'Connecting…',
    connected:    'Connected',
    disconnected: 'Not connected',
    error:        'Connection error',
  };
  statusText.textContent = labels[status] ?? status;
  statusDot.className    = status;
}

function updateTabTitle(title) {
  captionSource.textContent = title ? ` — ${title}` : '';
}

let switchNoticeTimer = null;
function showSwitchNotice() {
  switchNotice.style.display = 'block';
  clearTimeout(switchNoticeTimer);
  switchNoticeTimer = setTimeout(() => {
    switchNotice.style.display = 'none';
  }, 3000);
}
