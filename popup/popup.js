console.log('[UC] popup: loaded');

const btn              = document.getElementById('toggle-btn');
const providerEl       = document.getElementById('provider');
const groqApiKeyEl         = document.getElementById('api-key');
const backendEl        = document.getElementById('backend-url');
const statusDot        = document.getElementById('status-dot');
const statusText       = document.getElementById('status-text');
const fontSizeEl       = document.getElementById('font-size');
const fontSizeValEl    = document.getElementById('font-size-val');
const ovPositionEl     = document.getElementById('ov-position');
const bgOpacityEl      = document.getElementById('bg-opacity');
const bgOpacityValEl   = document.getElementById('bg-opacity-val');
const textOpacityEl    = document.getElementById('text-opacity');
const textOpacityValEl = document.getElementById('text-opacity-val');

let isCapturing = false;

// ---------------------------------------------------------------------------
// Restore persisted config + state
// ---------------------------------------------------------------------------
chrome.storage.local.get(
  ['capturing', 'wsStatus', 'provider', 'groqApiKey', 'backendUrl', 'overlayConfig'],
  (data) => {
    console.log('[UC] popup: restored storage', data);
    isCapturing          = !!data.capturing;
    providerEl.value     = data.provider    || 'openai_chunked';
    groqApiKeyEl.value       = data.groqApiKey      || '';
    backendEl.value      = data.backendUrl  || 'ws://localhost:8000';
    updateStatus(data.wsStatus || 'disconnected');
    syncButton();

    const oc = data.overlayConfig || {};
    const fs  = oc.fontSize   ?? 18;
    const bgo = Math.round((oc.bgOpacity   ?? 0.72) * 100);
    const txo = Math.round((oc.textOpacity ?? 1.0)  * 100);
    fontSizeEl.value          = fs;
    fontSizeValEl.textContent = fs;
    ovPositionEl.value        = oc.position ?? 'bottom';
    bgOpacityEl.value         = bgo;
    bgOpacityValEl.textContent = bgo;
    textOpacityEl.value          = txo;
    textOpacityValEl.textContent = txo;
  },
);

// ---------------------------------------------------------------------------
// Persist config fields on change
// ---------------------------------------------------------------------------
providerEl.addEventListener('change', () =>
  chrome.storage.local.set({ provider: providerEl.value }),
);
groqApiKeyEl.addEventListener('input', () =>
  chrome.storage.local.set({ groqApiKey: groqApiKeyEl.value }),
);
backendEl.addEventListener('input', () =>
  chrome.storage.local.set({ backendUrl: backendEl.value }),
);

// ---------------------------------------------------------------------------
// Listen for status changes written by the offscreen document
// ---------------------------------------------------------------------------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.wsStatus) {
    updateStatus(changes.wsStatus.newValue);
  }
});

// ---------------------------------------------------------------------------
// Overlay config persistence
// ---------------------------------------------------------------------------
function saveOverlayConfig() {
  chrome.storage.local.set({
    overlayConfig: {
      fontSize:    Number(fontSizeEl.value),
      position:    ovPositionEl.value,
      bgOpacity:   Number(bgOpacityEl.value)   / 100,
      textOpacity: Number(textOpacityEl.value) / 100,
    },
  });
}

fontSizeEl.addEventListener('input', () => {
  fontSizeValEl.textContent = fontSizeEl.value;
  saveOverlayConfig();
});
ovPositionEl.addEventListener('change', saveOverlayConfig);
bgOpacityEl.addEventListener('input', () => {
  bgOpacityValEl.textContent = bgOpacityEl.value;
  saveOverlayConfig();
});
textOpacityEl.addEventListener('input', () => {
  textOpacityValEl.textContent = textOpacityEl.value;
  saveOverlayConfig();
});

// ---------------------------------------------------------------------------
// Start / Stop
// ---------------------------------------------------------------------------
btn.addEventListener('click', async () => {
  console.log('[UC] popup: toggle clicked, isCapturing =', isCapturing);
  btn.disabled = true;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log('[UC] popup: active tab', tab?.id, tab?.url);

  if (!isCapturing) {
    const config = {
      provider:   providerEl.value,
      groqApiKey:     groqApiKeyEl.value,
      backendUrl: backendEl.value,
      model:      'whisper-1',
    };
    // Send open-pip directly to the content script while the popup click
    // user-gesture is still active — service worker would break the gesture chain
    chrome.tabs.sendMessage(tab.id, { action: 'open-pip' }).catch(() => {});

    console.log('[UC] popup: sending start with config', { ...config, groqApiKey: '***' });
    chrome.runtime.sendMessage({ action: 'start', tabId: tab.id, config }, (response) => {
      console.log('[UC] popup: start response', response);
      if (response?.ok) {
        isCapturing = true;
        chrome.storage.local.set({ capturing: true });
      }
      syncButton();
    });
  } else {
    console.log('[UC] popup: sending stop');
    chrome.tabs.sendMessage(tab.id, { action: 'close-pip' }).catch(() => {});
    chrome.runtime.sendMessage({ action: 'stop' }, (response) => {
      console.log('[UC] popup: stop response', response);
      isCapturing = false;
      chrome.storage.local.set({ capturing: false });
      syncButton();
    });
  }
});

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function syncButton() {
  btn.disabled    = false;
  btn.textContent = isCapturing ? 'Stop Captions' : 'Start Captions';
  btn.classList.toggle('active', isCapturing);
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
  console.log('[UC] popup: status →', status);
}
