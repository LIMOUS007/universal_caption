console.log('[UC] caption-overlay: loaded on', location.href);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = { fontSize: 18, bgOpacity: 0.78, textOpacity: 1.0 };
let _config   = { ...DEFAULT_CONFIG };
let _pos      = null; // { left, top, width } px — null means default bottom-center
let _isPinned = false;
let _root, _box, _textEl, _indicator, _pinBtn, _closeBtn, _resizeHdl;
let _captionTimer = null;

// ---------------------------------------------------------------------------
// Init on page load — auto-show if pinned + session already active
// ---------------------------------------------------------------------------
chrome.storage.local.get(
  ['overlayConfig', 'overlayPinned', 'overlayPosition', 'capturing'],
  (data) => {
    if (data.overlayConfig) _config = { ...DEFAULT_CONFIG, ...data.overlayConfig };
    _isPinned = !!data.overlayPinned;
    if (data.overlayPosition) _pos = data.overlayPosition;
    if (_isPinned && data.capturing) _ensureOverlay(false);
  }
);

// ---------------------------------------------------------------------------
// Storage change listener
// ---------------------------------------------------------------------------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (changes.overlayConfig?.newValue) {
    _config = { ...DEFAULT_CONFIG, ...changes.overlayConfig.newValue };
    if (_box) _applyConfig();
  }
  if (changes.overlayPosition?.newValue) {
    _pos = changes.overlayPosition.newValue;
    if (_box) _applyPosition();
  }
  if ('overlayPinned' in changes) {
    _isPinned = !!changes.overlayPinned.newValue;
    if (_pinBtn) _updatePinBtn();
    if (_isPinned && !_root) {
      chrome.storage.local.get('capturing', ({ capturing }) => {
        if (capturing) _ensureOverlay(false);
      });
    }
  }
  if ('capturing' in changes) {
    if (changes.capturing.newValue) {
      // Session started — drop preview styling
      if (_box) _box.classList.remove('preview');
    } else {
      // Session ended — remove overlay on all tabs
      _removeOverlay();
    }
  }
});

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.action) {
    case 'show-preview':
      if (message.config) _config = { ...DEFAULT_CONFIG, ...message.config };
      _ensureOverlay(true);
      sendResponse({ ok: true });
      return;

    case 'show-caption':
      _ensureOverlay(false);
      _showCaption(message.text);
      sendResponse({ ok: true });
      return;
  }
});

// ---------------------------------------------------------------------------
// Build overlay
// ---------------------------------------------------------------------------
function _ensureOverlay(preview = false) {
  if (_root) {
    if (!preview && _box) _box.classList.remove('preview');
    return;
  }
  if (!document.body) return;

  _root = document.createElement('div');
  _root.id = 'uc-root';
  Object.assign(_root.style, {
    position: 'fixed', top: '0', left: '0',
    width: '0', height: '0', zIndex: '2147483647', pointerEvents: 'none',
  });

  const shadow = _root.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
#box {
  position: fixed;
  z-index: 2147483647;
  min-width: 180px;
  min-height: 46px;
  border-radius: 10px;
  padding: 8px 48px 8px 14px;
  font-family: system-ui, -apple-system, sans-serif;
  cursor: grab;
  user-select: none;
  word-wrap: break-word;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1.5px solid rgba(255,255,255,0.10);
  pointer-events: auto;
}
#box.preview { border: 1.5px dashed rgba(255,255,255,0.38); }
#box.dragging { cursor: grabbing; }
#text { text-align: center; line-height: 1.45; word-break: break-word; flex: 1; }
@keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:.8} }
#indicator {
  width: 7px; height: 7px; border-radius: 50%;
  background: rgba(255,255,255,0.7);
  animation: pulse 1.5s ease-in-out infinite;
  flex-shrink: 0;
}
#indicator.hidden { display: none; }
#controls {
  position: absolute; top: 5px; right: 5px;
  display: flex; gap: 3px; align-items: center;
}
#controls button {
  width: 18px; height: 18px; border-radius: 3px; border: none;
  background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.55);
  cursor: pointer; font-size: 10px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  padding: 0; transition: background .15s, color .15s;
}
#controls button:hover { background: rgba(255,255,255,0.28); color: #fff; }
#pin-btn.pinned { background: rgba(255,200,0,0.35); color: #ffd700; }
#resize-handle {
  position: absolute; bottom: 3px; right: 3px;
  width: 14px; height: 14px; cursor: se-resize; opacity: .4;
  background: linear-gradient(135deg,
    transparent 33%, rgba(255,255,255,.7) 33%,
    rgba(255,255,255,.7) 40%, transparent 40%,
    transparent 60%, rgba(255,255,255,.7) 60%,
    rgba(255,255,255,.7) 67%, transparent 67%);
}
#resize-handle:hover { opacity: .9; }
</style>
<div id="box"${preview ? ' class="preview"' : ''}>
  <div id="controls">
    <button id="pin-btn" title="Pin to all tabs">&#x1F4CC;</button>
    <button id="close-btn" title="Stop captions">&#x2715;</button>
  </div>
  <span id="text"></span>
  <div id="indicator"></div>
  <div id="resize-handle"></div>
</div>`;

  _box       = shadow.getElementById('box');
  _textEl    = shadow.getElementById('text');
  _indicator = shadow.getElementById('indicator');
  _pinBtn    = shadow.getElementById('pin-btn');
  _closeBtn  = shadow.getElementById('close-btn');
  _resizeHdl = shadow.getElementById('resize-handle');

  document.body.appendChild(_root);
  _applyConfig();
  _applyPosition();
  _updatePinBtn();
  _setupDrag();
  _setupResize();

  _closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ action: 'stop' }).catch(() => {});
    chrome.storage.local.set({ capturing: false, overlayPinned: false, wsStatus: 'disconnected' });
    _removeOverlay();
  });

  _pinBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _isPinned = !_isPinned;
    chrome.storage.local.set({ overlayPinned: _isPinned });
    _updatePinBtn();
  });
}

function _removeOverlay() {
  clearTimeout(_captionTimer);
  _captionTimer = null;
  if (_root) _root.remove();
  _root = _box = _textEl = _indicator = _pinBtn = _closeBtn = _resizeHdl = null;
}

// ---------------------------------------------------------------------------
// Config + position
// ---------------------------------------------------------------------------
function _applyConfig() {
  _box.style.background      = `rgba(0,0,0,${_config.bgOpacity})`;
  _textEl.style.fontSize     = `${_config.fontSize}px`;
  _textEl.style.color        = `rgba(255,255,255,${_config.textOpacity})`;
}

function _applyPosition() {
  if (_pos) {
    _box.style.left      = `${_pos.left}px`;
    _box.style.top       = `${_pos.top}px`;
    _box.style.bottom    = '';
    _box.style.transform = '';
    if (_pos.width) _box.style.width = `${_pos.width}px`;
  } else {
    _box.style.bottom    = '28px';
    _box.style.left      = '50%';
    _box.style.top       = '';
    _box.style.transform = 'translateX(-50%)';
  }
}

function _savePosition() {
  const rect = _box.getBoundingClientRect();
  _pos = { left: rect.left, top: rect.top, width: rect.width };
  chrome.storage.local.set({ overlayPosition: _pos });
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------
function _showCaption(text) {
  if (!_box) return;
  _box.classList.remove('preview');
  _textEl.textContent = text;
  _indicator.classList.add('hidden');
  clearTimeout(_captionTimer);
  _captionTimer = setTimeout(() => {
    if (_textEl)    _textEl.textContent = '';
    if (_indicator) _indicator.classList.remove('hidden');
  }, 4000);
}

function _updatePinBtn() {
  if (!_pinBtn) return;
  _pinBtn.classList.toggle('pinned', _isPinned);
  _pinBtn.title = _isPinned ? 'Unpin from all tabs' : 'Pin to all tabs';
}

// ---------------------------------------------------------------------------
// Drag — moves the box using top/left
// ---------------------------------------------------------------------------
function _setupDrag() {
  let dragging = false, sx, sy, sl, st;

  _box.addEventListener('mousedown', (e) => {
    if (e.target.closest && e.target.closest('#controls, #resize-handle')) return;
    dragging = true;
    _box.classList.add('dragging');
    const rect = _box.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY;
    sl = rect.left;  st = rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    _box.style.transform = '';
    _box.style.left      = `${sl + e.clientX - sx}px`;
    _box.style.top       = `${st + e.clientY - sy}px`;
    _box.style.bottom    = '';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    _box.classList.remove('dragging');
    _savePosition();
  });
}

// ---------------------------------------------------------------------------
// Resize — changes width via the bottom-right handle
// ---------------------------------------------------------------------------
function _setupResize() {
  let resizing = false, sx, sw;

  _resizeHdl.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    resizing = true;
    sx = e.clientX;
    sw = _box.getBoundingClientRect().width;
  });

  document.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    const w = Math.max(150, Math.min(window.innerWidth * 0.9, sw + e.clientX - sx));
    _box.style.width = `${w}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false;
    _savePosition();
  });
}
