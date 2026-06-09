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
const errorNotice      = document.getElementById('error-notice');
const fontSizeEl       = document.getElementById('font-size');
const fontSizeValEl    = document.getElementById('font-size-val');
const bgOpacityEl      = document.getElementById('bg-opacity');
const bgOpacityValEl   = document.getElementById('bg-opacity-val');
const textOpacityEl    = document.getElementById('text-opacity');
const textOpacityValEl = document.getElementById('text-opacity-val');
const languageEl       = document.getElementById('language');

const lockableFields = ['field-api-key', 'field-backend-url', 'field-language'];

// API key show/hide
document.getElementById('toggle-key')?.addEventListener('click', () => {
  apiKeyEl.type = apiKeyEl.type === 'password' ? 'text' : 'password';
});

// Provider chip picker — each provider keeps its own key
const apiKeyLabelEl = document.getElementById('api-key-label');
const chips = document.querySelectorAll('.provider-chip');
let _apiKeys = { openai_chunked: '', groq: '', deepgram: '' };
let _activeProvider = 'openai_chunked';

function selectProviderChip(provider, { skipKeyUpdate = false } = {}) {
  chips.forEach(c => {
    const active = c.dataset.provider === provider;
    c.classList.toggle('active', active);
    if (active) {
      apiKeyLabelEl.textContent = c.dataset.label;
      apiKeyEl.placeholder      = c.dataset.placeholder;
    }
  });
  _activeProvider  = provider;
  providerEl.value = provider;
  if (!skipKeyUpdate) apiKeyEl.value = _apiKeys[provider] ?? '';
  chrome.storage.local.set({ provider });
}
chips.forEach(chip => {
  chip.addEventListener('click', () => selectProviderChip(chip.dataset.provider));
});

// Advanced section toggle
document.getElementById('advanced-toggle')?.addEventListener('click', function () {
  const section = document.getElementById('advanced-section');
  const open = section.classList.toggle('open');
  this.textContent = open ? 'Advanced ▴' : 'Advanced ▾';
});

let isCapturing = false;
let _activeTabId = null;

// ---------------------------------------------------------------------------
// Restore persisted config + state
// ---------------------------------------------------------------------------
chrome.storage.local.get(
  ['capturing', 'wsStatus', 'wsError', 'provider', 'apiKey', 'groqApiKey', 'apiKeys',
   'backendUrl', 'language', 'overlayConfig', 'captioningTabTitle', 'statusMessage'],
  (data) => {
    console.log('[UC] popup: restored storage', data);
    isCapturing = !!data.capturing;

    // Migrate legacy single-key storage into per-provider map
    _apiKeys = { openai_chunked: '', groq: '', deepgram: '', ...(data.apiKeys || {}) };
    if (!_apiKeys.openai_chunked && (data.apiKey || data.groqApiKey)) {
      _apiKeys.openai_chunked = data.apiKey || data.groqApiKey;
      chrome.storage.local.set({ apiKeys: _apiKeys });
      chrome.storage.local.remove(['apiKey', 'groqApiKey']);
    }

    selectProviderChip(data.provider || 'openai_chunked');
    backendEl.value  = data.backendUrl || 'ws://localhost:8000';
    languageEl.value = data.language   || '';
    updateStatus(data.wsStatus || 'disconnected');
    updateErrorNotice(data.wsError || null);
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
      chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
        if (!tab) return;
        _activeTabId = tab.id;
        const previewConfig = { fontSize: fs, bgOpacity: bgo / 100, textOpacity: txo / 100 };
        const sent = await chrome.tabs.sendMessage(tab.id, { action: 'show-preview', config: previewConfig }).catch(() => null);
        if (!sent) {
          // Content script not injected yet (page was open before extension loaded) — inject it
          try {
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/caption-overlay.js'] });
            chrome.tabs.sendMessage(tab.id, { action: 'show-preview', config: previewConfig }).catch(() => {});
          } catch (_) {}
        }
        // Port disconnect fires in the content script when popup closes —
        // more reliable than storage.set in the unload handler.
        try { chrome.tabs.connect(tab.id, { name: 'preview-lifecycle' }); } catch (_) {}
        chrome.storage.local.set({ previewActive: true });
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Persist config fields on change
// ---------------------------------------------------------------------------
apiKeyEl.addEventListener('input', () => {
  _apiKeys[_activeProvider] = apiKeyEl.value;
  chrome.storage.local.set({ apiKeys: _apiKeys });
  if (apiKeyEl.value.trim()) updateErrorNotice(null);
});
backendEl.addEventListener('input', () =>
  chrome.storage.local.set({ backendUrl: backendEl.value }),
);
languageEl.addEventListener('change', () =>
  chrome.storage.local.set({ language: languageEl.value }),
);

// ---------------------------------------------------------------------------
// Listen for status + tab title changes from service worker
// ---------------------------------------------------------------------------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.wsStatus)           updateStatus(changes.wsStatus.newValue);
  if ('wsError' in changes)       updateErrorNotice(changes.wsError.newValue || null);
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

  const key = apiKeyEl.value.trim();
  if (!key) {
    updateErrorNotice(`Enter a ${apiKeyLabelEl.textContent} to start captions.`);
    return;
  }
  updateErrorNotice(null);
  chrome.storage.local.set({ wsError: null });

  startBtn.disabled = true;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { syncButtons(); return; }
  _activeTabId = tab.id;
  console.log('[UC] popup: active tab', tab?.id, tab?.url);

  const providerModels = {
    openai_chunked: 'whisper-1',
    groq:           'whisper-large-v3-turbo',
    deepgram:       'nova-2',
  };
  const config = {
    provider:   _activeProvider,
    apiKey:     key,
    backendUrl: backendEl.value,
    model:      providerModels[_activeProvider] || 'whisper-1',
    language:   languageEl.value || undefined,
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
    chrome.storage.local.set({ capturing: false });
    syncButtons();

    // Re-show preview so the user can start again from the same popup
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab) return;
      _activeTabId = tab.id;
      const config = {
        fontSize:    Number(fontSizeEl.value),
        bgOpacity:   Number(bgOpacityEl.value) / 100,
        textOpacity: Number(textOpacityEl.value) / 100,
      };
      chrome.tabs.sendMessage(tab.id, { action: 'show-preview', config }).catch(() => {});
      try { chrome.tabs.connect(tab.id, { name: 'preview-lifecycle' }); } catch (_) {}
      chrome.storage.local.set({ previewActive: true });
    });
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

function updateErrorNotice(msg) {
  errorNotice.textContent     = msg || '';
  errorNotice.style.display   = msg ? 'block' : 'none';
}

let switchNoticeTimer = null;
function showSwitchNotice() {
  switchNotice.style.display = 'block';
  clearTimeout(switchNoticeTimer);
  switchNoticeTimer = setTimeout(() => {
    switchNotice.style.display = 'none';
  }, 3000);
}

// Remove preview overlay when popup closes without starting.
// chrome.tabs.sendMessage is async and dies before unload completes —
// storage.set is a synchronous IPC call that Chrome queues even during teardown.
window.addEventListener('unload', () => {
  if (!isCapturing) {
    chrome.storage.local.set({ previewActive: false });
  }
});
