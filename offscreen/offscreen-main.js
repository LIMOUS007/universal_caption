console.log('[UC] offscreen-main: loaded');

let _stream        = null;
let _audioPlayback = null;
let _recording     = false;
let _recorder      = null; // current MediaRecorder for the active 4 s window

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
// Audio capture
// ---------------------------------------------------------------------------
async function initAudio(streamId) {
  console.log('[UC] offscreen-main: initAudio() streamId =', streamId);
  _setStatus('connecting');

  console.log('[UC] offscreen-main: calling getUserMedia...');
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
      setTimeout(() => reject(new Error('getUserMedia timed out after 10 s')), 10_000)
    ),
  ]);
  console.log('[UC] offscreen-main: getUserMedia OK, tracks:', _stream.getAudioTracks().length);

  // Play the captured stream back so the user can still hear the tab
  _audioPlayback = new Audio();
  _audioPlayback.srcObject = _stream;
  _audioPlayback.play();

  const mimeType = 'audio/webm;codecs=opus';
  console.log('[UC] offscreen-main: MediaRecorder.isTypeSupported:', MediaRecorder.isTypeSupported(mimeType));

  _recording = true;
  _setStatus('connected');
  console.log('[UC] offscreen-main: starting record loop');
  recordLoop(mimeType); // fire-and-forget; runs until _recording = false
}

// ---------------------------------------------------------------------------
// Record loop — stop-and-restart so each blob is a complete WebM file.
// Using timeslice (start(N)) produces headerless fragments that Groq rejects.
// ---------------------------------------------------------------------------
async function recordLoop(mimeType) {
  while (_recording && _stream?.active) {
    const blob = await new Promise((resolve) => {
      _recorder = new MediaRecorder(_stream, { mimeType });
      _recorder.addEventListener('dataavailable', (e) => resolve(e.data), { once: true });
      _recorder.start();
      setTimeout(() => {
        if (_recorder?.state === 'recording') _recorder.stop();
      }, 2000);
    });

    console.log('[UC] offscreen-main: chunk — size:', blob.size, 'type:', blob.type);
    if (!_recording) break;        // stopped while we were recording
    if (blob.size < 5000) continue; // silent / near-empty chunk — skip to avoid wasting API calls

    const arrayBuffer  = await blob.arrayBuffer();
    const regularArray = Array.from(new Uint8Array(arrayBuffer));
    chrome.runtime.sendMessage({
      action:     'transcribe-chunk',
      audioArray: regularArray,
      mimeType:   blob.type,
    }).catch(() => {});
  }

  console.log('[UC] offscreen-main: record loop ended');
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------
function stopAudio() {
  console.log('[UC] offscreen-main: stopAudio()');

  _recording = false;
  if (_recorder?.state === 'recording') _recorder.stop();
  _stream?.getTracks().forEach((t) => t.stop());
  if (_audioPlayback) {
    _audioPlayback.pause();
    _audioPlayback.srcObject = null;
  }

  _recorder      = null;
  _stream        = null;
  _audioPlayback = null;

  _setStatus('disconnected');
  console.log('[UC] offscreen-main: audio pipeline torn down');
}

// ---------------------------------------------------------------------------
// Status helper — offscreen documents cannot access chrome.storage directly.
// The service worker receives 'connection-status' and writes to storage there.
// ---------------------------------------------------------------------------
function _setStatus(status) {
  chrome.runtime.sendMessage({ action: 'connection-status', status }).catch(() => {});
}
