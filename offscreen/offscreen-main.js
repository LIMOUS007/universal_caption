console.log('[UC] offscreen-main: loaded');

let _stream           = null;
let _playbackCtx      = null;  // native sample rate → speakers (zero-latency, no HTML5 buffer)
let _transcriptionCtx = null;  // 16kHz → AudioWorklet → service worker
let _recording        = false;

// ---------------------------------------------------------------------------
// Message handler (from service worker)
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[UC] offscreen-main: message', message.action);

  if (message.action === 'init-stream') {
    // Defer out of the message handler — getUserMedia hangs when called
    // synchronously inside a chrome.runtime.onMessage callback.
    setTimeout(() => {
      initAudio(message.streamId)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          console.error('[UC] offscreen-main: initAudio error', err);
          try { _setStatus('error'); } catch (_) {}
          sendResponse({ ok: false, error: err.message });
        });
    }, 0);
    return true;
  }

  if (message.action === 'stop-stream') {
    stopAudio();
    sendResponse({ ok: true });
  }
});

// ---------------------------------------------------------------------------
// Audio capture — dual AudioContext to decouple playback from transcription
// ---------------------------------------------------------------------------
function getRMS(float32Array) {
  let sum = 0;
  for (let i = 0; i < float32Array.length; i++) {
    sum += float32Array[i] * float32Array[i];
  }
  return Math.sqrt(sum / float32Array.length);
}

async function initAudio(streamId) {
  console.log('[UC] offscreen-main: initAudio() streamId =', streamId);
  _setStatus('connecting');

  _stream = await Promise.race([
    navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource:   'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('getUserMedia timed out after 10s')), 10000)
    ),
  ]);

  console.log('[UC] offscreen-main: getUserMedia OK, tracks:', _stream.getAudioTracks().length);

  // PATH A — Playback at native hardware rate, direct to speakers.
  // AudioContext.destination bypasses the HTML5 media buffer that caused the
  // 5-second startup gap and A/V drift.
  _playbackCtx = new AudioContext();
  const playbackSource = _playbackCtx.createMediaStreamSource(_stream);
  playbackSource.connect(_playbackCtx.destination);

  // PATH B — Separate context locked to 16kHz for Whisper. Not connected to
  // destination so the downsampled audio never reaches the speakers.
  _transcriptionCtx = new AudioContext({ sampleRate: 16000 });
  await _transcriptionCtx.audioWorklet.addModule('audio-processor.js');

  const transSource = _transcriptionCtx.createMediaStreamSource(_stream);
  const processor   = new AudioWorkletNode(_transcriptionCtx, 'uc-processor');

  _recording = true;

  processor.port.onmessage = (event) => {
    if (!_recording) return;

    const float32Array = event.data;
    const t1 = Date.now();
    console.log(`[UC LAT] T1 chunk_ready samples=${float32Array.length} t=${t1}`);

    const rms = getRMS(float32Array);
    if (rms < 0.0001) {
      console.debug('[UC] Skipping silent chunk, RMS:', rms);
      return;
    }

    const t2 = Date.now();
    console.log(`[UC LAT] T2 sending_to_sw t=${t2} (+${t2 - t1}ms since T1)`);
    chrome.runtime.sendMessage({
      action:    'audio-stream-data',
      audioData: Array.from(float32Array),
      _t2:       t2,
    }).catch(() => {});
  };

  transSource.connect(processor);
  // Do NOT connect processor to _transcriptionCtx.destination

  _setStatus('connected');
  console.log('[UC] offscreen-main: dual-context audio pipeline established.');
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------
function stopAudio() {
  console.log('[UC] offscreen-main: stopAudio()');

  _recording = false;

  if (_stream) {
    _stream.getTracks().forEach((t) => t.stop());
  }

  if (_playbackCtx && _playbackCtx.state !== 'closed') {
    _playbackCtx.close().catch(() => {});
  }
  if (_transcriptionCtx && _transcriptionCtx.state !== 'closed') {
    _transcriptionCtx.close().catch(() => {});
  }

  _stream           = null;
  _playbackCtx      = null;
  _transcriptionCtx = null;

  _setStatus('disconnected');
  console.log('[UC] offscreen-main: audio pipeline torn down');
}

// ---------------------------------------------------------------------------
// Status helper
// ---------------------------------------------------------------------------
function _setStatus(status) {
  chrome.runtime.sendMessage({ action: 'connection-status', status }).catch(() => {});
}
