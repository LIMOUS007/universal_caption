console.log('[UC] caption-overlay: loaded on', location.href);

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
    case 'show-caption':
      showCaption(message.text);
      sendResponse({ status: 'ok' });
      return;
    case 'hide-overlay':
      removeOverlay();
      sendResponse({ status: 'ok' });
      return;
  }
  // Unknown message — do NOT return true; don't hold the channel open
});

// ---------------------------------------------------------------------------
// Config — load once, then track live changes from popup
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
// Overlay — create / update / destroy
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

function showCaption(text) {
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
  if (_hideTimer) {
    clearTimeout(_hideTimer);
    _hideTimer = null;
  }
  if (_root) {
    _root.remove();
    _root    = null;
    _box     = null;
    _textEl  = null;
  }
}
