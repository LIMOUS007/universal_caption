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
let _pageTimer    = null;

// ---------------------------------------------------------------------------
// Init on page load — auto-show if pinned + session already active
// ---------------------------------------------------------------------------
chrome.storage.local.get(
  ['overlayConfig', 'overlayPinned', 'overlayPosition', 'capturing'],
  (data) => {
    if (data.overlayConfig) _config = { ...DEFAULT_CONFIG, ...data.overlayConfig };
    _isPinned = !!data.overlayPinned;
    if (data.overlayPosition) {
      const p = data.overlayPosition;
      _pos = { left: p.left, top: p.top, width: p.width }; // strip any saved height
    }
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
        clearTimeout(_pageTimer); _pageTimer = null;
        _box.classList.remove('preview');
        _textEl.innerHTML    = '';
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
  max-width: 98vw;
  border-radius: 10px;
  padding: 10px 48px 10px 14px;
  font-family: system-ui, -apple-system, sans-serif;
  cursor: grab;
  user-select: none;
  border: 1.5px solid rgba(255,255,255,0.10);
  pointer-events: auto;
  overflow: visible;
}
#box.preview { border: 1.5px dashed rgba(255,255,255,0.38); }
#box.dragging { cursor: grabbing; }
#text {
  display: block;
  text-align: center;
  line-height: 1.5;
  word-break: break-word;
  overflow-wrap: break-word;
  min-height: 1.5em;
}
#text.idle { opacity: 0.25; transition: opacity 0.6s; }
@keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:.8} }
#indicator {
  display: block;
  width: 7px; height: 7px; border-radius: 50%;
  background: rgba(255,255,255,0.7);
  animation: pulse 1.5s ease-in-out infinite;
  margin: 6px auto 0;
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
</style>
<div id="box"${preview ? ' class="preview"' : ''}>
  <div id="controls">
    <button id="pin-btn" title="Pin to all tabs">&#x1F4CC;</button>
    <button id="close-btn" title="Stop captions">&#x2715;</button>
  </div>
  <div id="text"></div>
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
  clearTimeout(_pageTimer);
  _captionTimer = _pageTimer = null;
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
    _box.style.height    = '';
    if (_pos.width) _box.style.width = `${_pos.width}px`;
  } else {
    _box.style.bottom    = '28px';
    _box.style.left      = '50%';
    _box.style.top       = '';
    _box.style.height    = '';
    _box.style.transform = 'translateX(-50%)';
  }
}

function _savePosition() {
  const rect = _box.getBoundingClientRect();
  _pos = { left: rect.left, top: rect.top, width: rect.width };
  chrome.storage.local.set({ overlayPosition: _pos });
}

// ---------------------------------------------------------------------------
// Captions — 5-word pages, no grey, no word loss.
// Shows whatever words arrived (even < 5) immediately — never waits to fill
// a full page. Idle fires only after the last page + 6s to avoid false
// mid-sentence stops during brief inter-chunk gaps.
// ---------------------------------------------------------------------------
function _showCaption(text) {
  if (!_box) return;
  console.log(`[UC LAT] T5 overlay_display t=${Date.now()} text="${text.slice(0, 40)}"`);
  clearTimeout(_pageTimer);
  clearTimeout(_captionTimer);
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return;
  const pages = [];
  for (let i = 0; i < words.length; i += 5) pages.push(words.slice(i, i + 5).join(' '));
  _displayPage(pages, 0);
}

function _displayPage(pages, idx) {
  if (!_box || idx >= pages.length) return;
  _box.classList.remove('preview');
  _textEl.classList.remove('idle');
  _textEl.style.opacity = '';
  _textEl.textContent = pages[idx];
  if (_indicator) _indicator.classList.add('hidden');

  if (idx + 1 < pages.length) {
    _pageTimer = setTimeout(() => _displayPage(pages, idx + 1), 1000);
  } else {
    _captionTimer = setTimeout(() => {
      if (_textEl)    _textEl.classList.add('idle');
      if (_indicator) _indicator.classList.remove('hidden');
    }, 6000);
  }
}

function _updatePinBtn() {
  if (!_pinBtn) return;
  _pinBtn.classList.toggle('pinned', _isPinned);
  _pinBtn.title = _isPinned ? 'Unpin from all tabs' : 'Pin to all tabs';
}

// ---------------------------------------------------------------------------
// Resize zone detection — width-only (E/W edges). Height is auto-sized by
// content so N/S resize is intentionally omitted.
// ---------------------------------------------------------------------------
function _getResizeDir(clientX, clientY) {
  const r = _box.getBoundingClientRect();
  const x = clientX - r.left;
  const Z = 12;
  if (x < Z)            return 'w';
  if (x > r.width - Z)  return 'e';
  return null;
}

// ---------------------------------------------------------------------------
// Drag + resize — single handler; resize direction from cursor coordinates,
// not event targets, so Shadow DOM retargeting cannot interfere.
// ---------------------------------------------------------------------------
function _setupInteraction() {
  let mode = null; // 'drag' | 'resize'
  let dir, sx, sy, sl, st, sr;

  // Update cursor as mouse moves over the box.
  _box.addEventListener('mousemove', (e) => {
    if (mode) return;
    const path = e.composedPath();
    if (path.some(el => el.id === 'controls' || el.id === 'pin-btn' || el.id === 'close-btn')) {
      _box.style.cursor = 'default'; return;
    }
    const d = _getResizeDir(e.clientX, e.clientY);
    _box.style.cursor = d ? `${d}-resize` : 'grab';
  });
  _box.addEventListener('mouseleave', () => { if (!mode) _box.style.cursor = 'grab'; });

  _box.addEventListener('mousedown', (e) => {
    const path = e.composedPath();
    if (path.some(el => el.id === 'controls' || el.id === 'pin-btn' || el.id === 'close-btn')) return;
    e.preventDefault();
    const d = _getResizeDir(e.clientX, e.clientY);
    if (d) {
      mode = 'resize'; dir = d;
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
      let { left, width } = sr;
      if (dir === 'e') width = Math.max(150, Math.min(window.innerWidth - sr.left - 8, sr.width + dx));
      if (dir === 'w') { const nw = Math.max(150, Math.min(sr.left + sr.width - 8, sr.width - dx)); left = sr.left + sr.width - nw; width = nw; }
      _box.style.left   = `${left}px`;
      _box.style.width  = `${width}px`;
      _box.style.bottom = ''; _box.style.transform = '';
    }
  });

  document.addEventListener('mouseup', () => {
    if (!mode) return;
    if (mode === 'drag') _box.classList.remove('dragging');
    _box.style.cursor = 'grab';
    mode = null;
    _savePosition();
  });
}
