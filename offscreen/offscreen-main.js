console.log('[UC] offscreen-main: loaded');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let _ws          = null;
let audioContext = null;
let sourceNode   = null;
let workletNode  = null;
let silentGain   = null;
let stream       = null;

// PCM accumulation — send 0.5 s chunks to the backend (8 000 samples @ 16 kHz)
const SEND_SAMPLES = 8_000;
let _accParts = [];
let _accLen   = 0;

// ---------------------------------------------------------------------------
// Message handler (from service worker)
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[UC] offscreen-main: message', message.action);

  if (message.action === 'init-stream') {
    initAudio(message.streamId, message.config)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('[UC] offscreen-main: initAudio error', err);
        _setStatus('error');
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  if (message.action === 'stop-stream') {
    stopAudio();
    sendResponse({ ok: true });
  }
});

// ---------------------------------------------------------------------------
// Initialise audio pipeline + backend WebSocket
// ---------------------------------------------------------------------------
async function initAudio(streamId, config) {
  console.log('[UC] offscreen-main: initAudio()', { streamId, provider: config?.provider });

  _setStatus('connecting');

  // 1. Open WebSocket to backend
  const wsUrl = `${(config.backendUrl || 'ws://localhost:8000').replace(/\/$/, '')}/ws/transcribe`;
  _ws = new WebSocket(wsUrl);
  console.log('[UC] offscreen-main: connecting to', wsUrl);

  await new Promise((resolve, reject) => {
    _ws.addEventListener('open', resolve, { once: true });
    _ws.addEventListener('error', (e) => reject(new Error('WebSocket failed to open')), { once: true });
  });
  console.log('[UC] offscreen-main: WebSocket open');

  // 2. Send session config
  _ws.send(JSON.stringify({
    type:        'session_start',
    provider:    config.provider    || 'openai_chunked',
    api_key:     config.apiKey      || '',
    model:       config.model       || 'whisper-1',
    sample_rate: 16_000,
    encoding:    'pcm_f32le',
  }));

  // 3. Handle messages from backend
  _ws.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    console.log('[UC] offscreen-main: backend →', msg.type, msg.text ?? '');

    switch (msg.type) {
      case 'session_started':
        _setStatus('connected');
        break;
      case 'transcript':
      case 'transcript_delta':
        chrome.runtime.sendMessage({
          action:  'transcript',
          text:    msg.text,
          isFinal: msg.is_final,
        });
        break;
      case 'error':
        console.error('[UC] offscreen-main: backend error', msg.message);
        _setStatus('error');
        break;
      case 'session_ended':
        _setStatus('disconnected');
        break;
    }
  });

  _ws.addEventListener('close', () => {
    console.log('[UC] offscreen-main: WebSocket closed');
    _setStatus('disconnected');
  });

  // 4. Acquire tab audio stream
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource:   'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });
  console.log('[UC] offscreen-main: stream active =', stream.active,
    '| tracks:', stream.getAudioTracks().length);

  // 5. Build Web Audio graph
  audioContext = new AudioContext({ sampleRate: 16_000 });
  await audioContext.audioWorklet.addModule(
    chrome.runtime.getURL('offscreen/audio-processor.js'),
  );
  console.log('[UC] offscreen-main: AudioWorklet module loaded');

  sourceNode = audioContext.createMediaStreamSource(stream);
  workletNode = new AudioWorkletNode(audioContext, 'uc-processor');

  // 6. Accumulate PCM chunks and forward to backend over WebSocket
  workletNode.port.onmessage = (event) => {
    const chunk = /** @type {Float32Array} */ (event.data);
    _accParts.push(chunk);
    _accLen += chunk.length;

    if (_accLen >= SEND_SAMPLES) {
      const combined = new Float32Array(_accLen);
      let off = 0;
      for (const c of _accParts) { combined.set(c, off); off += c.length; }

      if (_ws?.readyState === WebSocket.OPEN) {
        _ws.send(combined.buffer);
      }

      _accParts = [];
      _accLen   = 0;
    }
  };

  // Silent gain keeps the graph active without playing audio back to speakers
  silentGain = audioContext.createGain();
  silentGain.gain.value = 0;
  sourceNode.connect(workletNode);
  workletNode.connect(silentGain);
  silentGain.connect(audioContext.destination);

  console.log('[UC] offscreen-main: audio pipeline connected — streaming to backend');
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------
function stopAudio() {
  console.log('[UC] offscreen-main: stopAudio()');

  if (_ws) {
    if (_ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: 'session_end' }));
      _ws.close();
    }
    _ws = null;
  }

  workletNode?.port.close();
  workletNode?.disconnect();
  silentGain?.disconnect();
  sourceNode?.disconnect();
  stream?.getTracks().forEach((t) => t.stop());
  audioContext?.close();

  audioContext = null;
  sourceNode   = null;
  workletNode  = null;
  silentGain   = null;
  stream       = null;
  _accParts    = [];
  _accLen      = 0;

  _setStatus('disconnected');
  console.log('[UC] offscreen-main: audio pipeline torn down');
}

// ---------------------------------------------------------------------------
// Status helper — writes to storage so the popup can read it
// ---------------------------------------------------------------------------
function _setStatus(status) {
  chrome.storage.local.set({ wsStatus: status });
  chrome.runtime.sendMessage({ action: 'connection-status', status });
}
