console.log('[UC] offscreen-main: loaded');

let _stream        = null;
let _audioPlayback = null;
let _recording     = false;
let _audioCtx      = null;

// ---------------------------------------------------------------------------
// Message handler (from service worker)
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[UC] offscreen-main: message', message.action);

  if (message.action === 'init-stream') {
    const streamId = message.streamId;
    // Defer out of the message handler — getUserMedia hangs when called
    // synchronously inside a chrome.runtime.onMessage callback.
    setTimeout(() => {
      initAudio(streamId)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          console.error('[UC] offscreen-main: initAudio error', err);
          try { _setStatus('error'); } catch (_) {}
          sendResponse({ ok: false, error: err.message });
        });
    }, 0);
    return true; // keep channel open for async sendResponse
  }

  if (message.action === 'stop-stream') {
    stopAudio();
    sendResponse({ ok: true });
  }
});

// ---------------------------------------------------------------------------
// Audio capture via AudioContext & AudioWorklet
// ---------------------------------------------------------------------------
async function initAudio(streamId) {
  console.log('[UC] offscreen-main: initAudio() streamId =', streamId);
  _setStatus('connecting');

  console.log('[UC] offscreen-main: calling getUserMedia...');
  
  // Use Promise.race to catch timeouts if getUserMedia hangs
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
      setTimeout(() => reject(new Error('getUserMedia timed out after 10 s')), 10000)
    ),
  ]);
  
  console.log('[UC] offscreen-main: getUserMedia OK, tracks:', _stream.getAudioTracks().length);

  // 1. Play the captured stream back so the user can still hear the tab audio natively
  _audioPlayback = new Audio();
  _audioPlayback.srcObject = _stream;
  _audioPlayback.play();

  // 2. Create an AudioContext locked to 16,000 Hz (Whisper's required sample rate)
  _audioCtx = new AudioContext({ sampleRate: 16000 });
  
  // 3. Load the Worklet processor (must be in the same folder as this script)
  await _audioCtx.audioWorklet.addModule('audio-processor.js');

  const source = _audioCtx.createMediaStreamSource(_stream);
  const processor = new AudioWorkletNode(_audioCtx, 'uc-processor');

  _recording = true;

  // 4. When the processor spits out raw Float32 audio, send it to the Service Worker
  processor.port.onmessage = (event) => {
    if (!_recording) return;
    
    // The AudioWorklet sends a Float32Array. We convert it to a standard Array 
    // because Chrome's extension message passing strips out TypedArrays.
    const float32Array = event.data; 
    
    chrome.runtime.sendMessage({
      action: 'audio-stream-data',
      audioData: Array.from(float32Array) 
    }).catch(() => {});
  };

  // Connect source -> processor. 
  // We DO NOT connect the processor to _audioCtx.destination because 
  // _audioPlayback is already handling the sound output.
  source.connect(processor);

  _setStatus('connected');
  console.log('[UC] offscreen-main: Audio pipeline established and streaming.');
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------
function stopAudio() {
  console.log('[UC] offscreen-main: stopAudio()');

  _recording = false;
  
  // Stop the media stream tracks
  if (_stream) {
    _stream.getTracks().forEach((t) => t.stop());
  }
  
  // Stop playback
  if (_audioPlayback) {
    _audioPlayback.pause();
    _audioPlayback.srcObject = null;
  }

  // Gracefully close the AudioContext
  if (_audioCtx && _audioCtx.state !== 'closed') {
    _audioCtx.close().catch(() => {});
  }

  _stream        = null;
  _audioPlayback = null;
  _audioCtx      = null;

  _setStatus('disconnected');
  console.log('[UC] offscreen-main: audio pipeline torn down');
}

// ---------------------------------------------------------------------------
// Status helper
// ---------------------------------------------------------------------------
function _setStatus(status) {
  chrome.runtime.sendMessage({ action: 'connection-status', status }).catch(() => {});
}