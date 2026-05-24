console.log('[UC] popup: loaded');

const btn         = document.getElementById('toggle-btn');
const providerEl  = document.getElementById('provider');
const apiKeyEl    = document.getElementById('api-key');
const backendEl   = document.getElementById('backend-url');
const statusDot   = document.getElementById('status-dot');
const statusText  = document.getElementById('status-text');

let isCapturing = false;

// ---------------------------------------------------------------------------
// Restore persisted config + state
// ---------------------------------------------------------------------------
chrome.storage.local.get(
  ['capturing', 'wsStatus', 'provider', 'apiKey', 'backendUrl'],
  (data) => {
    console.log('[UC] popup: restored storage', data);
    isCapturing          = !!data.capturing;
    providerEl.value     = data.provider    || 'openai_chunked';
    apiKeyEl.value       = data.apiKey      || '';
    backendEl.value      = data.backendUrl  || 'ws://localhost:8000';
    updateStatus(data.wsStatus || 'disconnected');
    syncButton();
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
// Listen for status changes written by the offscreen document
// ---------------------------------------------------------------------------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.wsStatus) {
    updateStatus(changes.wsStatus.newValue);
  }
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
      apiKey:     apiKeyEl.value,
      backendUrl: backendEl.value,
      model:      'whisper-1',
    };
    console.log('[UC] popup: sending start with config', { ...config, apiKey: '***' });
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
