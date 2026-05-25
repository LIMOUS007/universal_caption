console.log('[UC] caption-overlay: loaded on', location.href);

// ---------------------------------------------------------------------------
// PiP state
// ---------------------------------------------------------------------------
let _pipWindow = null;

// ---------------------------------------------------------------------------
// Shadow DOM fallback state
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = {
  fontSize:    18,
  position:    'bottom',
  bgOpacity:   0.72,
  textOpacity: 1.0,
};
let _config    = { ...DEFAULT_CONFIG };
let _root      = null;
let _box       = null;
let _textEl    = null;
let _hideTimer = null;

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.action) {
    case 'open-pip':
      openPip()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          console.warn('[UC] caption-overlay: openPip failed —', err.message);
          sendResponse({ ok: false, error: err.message });
        });
      return true; // async response

    case 'close-pip':
      closePip();
      removeOverlay();
      sendResponse({ ok: true });
      return;

    case 'show-caption':
      showCaption(message.text);
      sendResponse({ status: 'ok' });
      return;

    case 'hide-overlay':
      closePip();
      removeOverlay();
      sendResponse({ status: 'ok' });
      return;
  }
});

// ---------------------------------------------------------------------------
// Document Picture-in-Picture
// ---------------------------------------------------------------------------
async function openPip() {
  if (!('documentPictureInPicture' in window)) {
    console.warn('[UC] caption-overlay: Document PiP not supported — using Shadow DOM fallback');
    return;
  }

  if (_pipWindow && !_pipWindow.closed) return; // already open

  _pipWindow = await documentPictureInPicture.requestWindow({
    width:                  600,
    height:                 110,
    disallowReturnToOpener: false,
  });

  const html = await fetch(chrome.runtime.getURL('pip/pip-window.html')).then((r) => r.text());
  _pipWindow.document.open();
  _pipWindow.document.write(html);
  _pipWindow.document.close();

  // Clear reference when the user dismisses the PiP window manually
  _pipWindow.addEventListener('pagehide', () => { _pipWindow = null; });
}

function closePip() {
  if (_pipWindow && !_pipWindow.closed) {
    _pipWindow.close();
  }
  _pipWindow = null;
}

// ---------------------------------------------------------------------------
// Caption routing
// ---------------------------------------------------------------------------
function showCaption(text) {
  if (_pipWindow && !_pipWindow.closed) {
    _pipWindow.postMessage({ type: 'caption', text }, '*');
  } else {
    // PiP not available or user dismissed it — fall back to Shadow DOM overlay
    showOverlay(text);
  }
}

// ---------------------------------------------------------------------------
// Config — drives Shadow DOM fallback only
// ---------------------------------------------------------------------------
chrome.storage.local.get('overlayConfig', ({ overlayConfig }) => {
  if (overlayConfig) _config = { ...DEFAULT_CONFIG, ...overlayConfig };
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.overlayConfig) {
    _config = { ...DEFAULT_CONFIG, ...changes.overlayConfig.newValue };
    if (_box) applyConfig();
  }
});

// ---------------------------------------------------------------------------
// Shadow DOM overlay (fallback)
// ---------------------------------------------------------------------------
function ensureOverlay() {
  if (_root) return;
  if (!document.body) return;

  _root = document.createElement('div');
  _root.id = 'uc-root';

  const shadow = _root.attachShadow({ mode: 'closed' });

  _box = document.createElement('div');
  _box.style.cssText = [
    'position: fixed',
    'z-index: 2147483647',
    'pointer-events: none',
    'max-width: 60%',
    'min-width: 320px',
    'padding: 10px 18px',
    'border-radius: 10px',
    'word-wrap: break-word',
    'opacity: 0',
    'transition: opacity 0.15s ease',
  ].join(';');

  _textEl = document.createElement('span');
  _textEl.style.cssText = 'font-family: system-ui, sans-serif; line-height: 1.45;';

  _box.appendChild(_textEl);
  shadow.appendChild(_box);
  document.body.appendChild(_root);

  applyConfig();
}

function applyConfig() {
  if (!_box || !_textEl) return;

  _box.style.background = `rgba(0,0,0,${_config.bgOpacity})`;
  _textEl.style.fontSize = `${_config.fontSize}px`;
  _textEl.style.color = `rgba(255,255,255,${_config.textOpacity})`;

  _box.style.top       = '';
  _box.style.bottom    = '';
  _box.style.left      = '';
  _box.style.right     = '';
  _box.style.transform = '';

  switch (_config.position) {
    case 'top':
      _box.style.top   = '28px';
      _box.style.left  = '50%';
      _box.style.transform = 'translateX(-50%)';
      break;
    case 'bottom-left':
      _box.style.bottom = '28px';
      _box.style.left   = '20px';
      break;
    case 'bottom-right':
      _box.style.bottom = '28px';
      _box.style.right  = '20px';
      break;
    case 'bottom':
    default:
      _box.style.bottom    = '28px';
      _box.style.left      = '50%';
      _box.style.transform = 'translateX(-50%)';
      break;
  }
}

function showOverlay(text) {
  ensureOverlay();
  if (!_box || !_textEl) return;

  _textEl.textContent = text;
  _box.style.transition = 'opacity 0.15s ease';
  _box.style.opacity    = '1';

  if (_hideTimer) clearTimeout(_hideTimer);
  _hideTimer = setTimeout(() => {
    if (_box) {
      _box.style.transition = 'opacity 0.3s ease';
      _box.style.opacity    = '0';
    }
  }, 4000);
}

function removeOverlay() {
  if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
  if (_root) {
    _root.remove();
    _root   = null;
    _box    = null;
    _textEl = null;
  }
}
