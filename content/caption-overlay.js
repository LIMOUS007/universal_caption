console.log('[UC] caption-overlay: loaded on', location.href);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = { fontSize: 18, bgOpacity: 0.78, textOpacity: 1.0 };
let _config   = { ...DEFAULT_CONFIG };
let _pos      = null; // { left, top, width, height } px — null means default bottom-center
let _isPinned = false;
let _root, _box, _textEl, _indicator, _pinBtn, _closeBtn;
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
  if ('previewActive' in changes && !changes.previewActive.newValue) {
    if (_root && _box?.classList.contains('preview')) _removeOverlay();
  }
  if ('capturing' in changes) {
    if (changes.capturing.newValue) {
      if (_box) {
        // Session started — drop preview styling, clear sample text, start pulsing
        _box.classList.remove('preview');
        _textEl.textContent  = '';
        _textEl.style.opacity = '';
        if (_indicator) _indicator.classList.remove('hidden');
      } else if (_isPinned) {
        // Fix #7: create overlay on already-open pinned tabs when capture starts
        _ensureOverlay(false);
      }
    } else {
      // Session ended — remove overlay on all tabs
      _removeOverlay();
    }
  }
});

// ---------------------------------------------------------------------------
// Preview lifecycle — port from popup disconnects when popup closes,
// which is more reliable than storage.set in the unload handler.
// ---------------------------------------------------------------------------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'preview-lifecycle') return;
  port.onDisconnect.addListener(() => {
    if (_root && _box?.classList.contains('preview')) _removeOverlay();
  });
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
      // Only show on this tab if it already has the overlay, or if it's pinned.
      if (_root || _isPinned) {
        _ensureOverlay(false);
        _showCaption(message.text);
      }
      sendResponse({ ok: true });
      return;

    case 'hide-preview':
      // Fix #2: popup closed without starting — remove preview overlay
      _removeOverlay();
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
  min-height: 44px;
  max-width: 560px;
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
#text.idle { opacity: 0.32; transition: opacity 0.6s; }
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
  z-index: 20;
}
#controls button {
  width: 18px; height: 18px; border-radius: 3px; border: none;
  background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.55);
  cursor: pointer; font-size: 10px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  padding: 0; transition: background .15s, color .15s;
}
#controls button:hover { background: rgba(255,255,255,0.28); color: #fff; }
#pin-btn.pinned { background: rgba(255,175,0,0.80); color: #fff; font-weight: 700; }
.rz { position: absolute; z-index: 10; }
.rz-n  { top: 0;     left: 10px;   right: 10px;  height: 10px; cursor: n-resize;  }
.rz-s  { bottom: 0;  left: 10px;   right: 10px;  height: 10px; cursor: s-resize;  }
.rz-e  { top: 10px;  bottom: 10px; right: 0;     width: 10px;  cursor: e-resize;  }
.rz-w  { top: 10px;  bottom: 10px; left: 0;      width: 10px;  cursor: w-resize;  }
.rz-ne { top: 0;     right: 0;     width: 10px;  height: 10px; cursor: ne-resize; }
.rz-nw { top: 0;     left: 0;      width: 10px;  height: 10px; cursor: nw-resize; }
.rz-se { bottom: 0;  right: 0;     width: 10px;  height: 10px; cursor: se-resize; }
.rz-sw { bottom: 0;  left: 0;      width: 10px;  height: 10px; cursor: sw-resize; }
</style>
<div id="box"${preview ? ' class="preview"' : ''}>
  <div class="rz rz-n"></div>
  <div class="rz rz-s"></div>
  <div class="rz rz-e"></div>
  <div class="rz rz-w"></div>
  <div class="rz rz-ne"></div>
  <div class="rz rz-nw"></div>
  <div class="rz rz-se"></div>
  <div class="rz rz-sw"></div>
  <div id="controls">
    <button id="pin-btn" title="Pin to all tabs">&#x1F4CC;</button>
    <button id="close-btn" title="Stop captions">&#x2715;</button>
  </div>
  <span id="text"></span>
  <div id="indicator" class="hidden"></div>
</div>`;

  _box       = shadow.getElementById('box');
  _textEl    = shadow.getElementById('text');
  _indicator = shadow.getElementById('indicator');
  _pinBtn    = shadow.getElementById('pin-btn');
  _closeBtn  = shadow.getElementById('close-btn');

  document.body.appendChild(_root);
  _applyConfig();
  _applyPosition();
  _updatePinBtn();
  _setupInteraction();

  // Fix #1: show sample text in preview so sliders are visually testable
  if (preview) {
    _textEl.textContent   = 'Sample caption text';
    _textEl.style.opacity = '0.5';
  } else {
    // Non-preview start (pinned tab auto-show): start pulsing indicator
    _indicator.classList.remove('hidden');
  }

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
  _root = _box = _textEl = _indicator = _pinBtn = _closeBtn = null;
}

// ---------------------------------------------------------------------------
// Config + position
// ---------------------------------------------------------------------------
function _applyConfig() {
  _box.style.background  = `rgba(0,0,0,${_config.bgOpacity})`;
  _textEl.style.fontSize = `${_config.fontSize}px`;
  _textEl.style.color    = `rgba(255,255,255,${_config.textOpacity})`;
}

function _applyPosition() {
  if (_pos) {
    _box.style.left      = `${_pos.left}px`;
    _box.style.top       = `${_pos.top}px`;
    _box.style.bottom    = '';
    _box.style.transform = '';
    if (_pos.width)  _box.style.width  = `${_pos.width}px`;
    if (_pos.height) _box.style.height = `${_pos.height}px`;
  } else {
    _box.style.bottom    = '28px';
    _box.style.left      = '50%';
    _box.style.top       = '';
    _box.style.transform = 'translateX(-50%)';
  }
}

function _savePosition() {
  const rect = _box.getBoundingClientRect();
  _pos = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  chrome.storage.local.set({ overlayPosition: _pos });
}

// ---------------------------------------------------------------------------
// Captions — Fix #3: keep last caption visible (faded) instead of clearing
// ---------------------------------------------------------------------------
function _showCaption(text) {
  if (!_box) return;
  _box.classList.remove('preview');
  _textEl.classList.remove('idle');
  _textEl.style.opacity = '';
  _textEl.textContent   = text;
  if (_indicator) _indicator.classList.add('hidden');
  clearTimeout(_captionTimer);
  _captionTimer = setTimeout(() => {
    if (_textEl)    _textEl.classList.add('idle');
    if (_indicator) _indicator.classList.remove('hidden');
  }, 4000);
}

function _updatePinBtn() {
  if (!_pinBtn) return;
  _pinBtn.classList.toggle('pinned', _isPinned);
  _pinBtn.title = _isPinned ? 'Unpin from all tabs' : 'Pin to all tabs';
}

// ---------------------------------------------------------------------------
// Drag + resize — unified handler using e.composedPath() for reliable
// Shadow DOM event targeting. e.target is retargeted at shadow boundaries
// and cannot be trusted to identify rz zones; composedPath() gives the
// full inner path regardless of shadow mode.
// ---------------------------------------------------------------------------
function _setupInteraction() {
  let mode = null; // 'drag' | 'resize'
  let dir, sx, sy, sl, st, sr;

  _box.addEventListener('mousedown', (e) => {
    const path = e.composedPath();
    if (path.some(el => el.id === 'controls' || el.id === 'pin-btn' || el.id === 'close-btn')) return;

    const rzEl = path.find(el => el.nodeType === Node.ELEMENT_NODE && el.classList?.contains('rz'));
    e.preventDefault();

    if (rzEl) {
      mode = 'resize';
      dir  = [...rzEl.classList].find(c => c.startsWith('rz-')).slice(3);
      sx = e.clientX; sy = e.clientY;
      const rect = _box.getBoundingClientRect();
      sr = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    } else {
      mode = 'drag';
      _box.classList.add('dragging');
      const rect = _box.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY;
      sl = rect.left;  st = rect.top;
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (mode === 'drag') {
      _box.style.transform = '';
      _box.style.left      = `${sl + e.clientX - sx}px`;
      _box.style.top       = `${st + e.clientY - sy}px`;
      _box.style.bottom    = '';
    } else if (mode === 'resize') {
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      let { left, top, width, height } = sr;

      if (dir.includes('e')) width  = Math.max(150, Math.min(window.innerWidth  * 0.9, sr.width  + dx));
      if (dir.includes('w')) { const nw = Math.max(150, sr.width  - dx); left = sr.left + sr.width  - nw; width  = nw; }
      if (dir.includes('s')) height = Math.max(44,  Math.min(window.innerHeight * 0.9, sr.height + dy));
      if (dir.includes('n')) { const nh = Math.max(44,  sr.height - dy); top  = sr.top  + sr.height - nh; height = nh; }

      _box.style.left      = `${left}px`;
      _box.style.top       = `${top}px`;
      _box.style.width     = `${width}px`;
      _box.style.height    = `${height}px`;
      _box.style.bottom    = '';
      _box.style.transform = '';
    }
  });

  document.addEventListener('mouseup', () => {
    if (!mode) return;
    if (mode === 'drag') _box.classList.remove('dragging');
    mode = null;
    _savePosition();
  });
}
