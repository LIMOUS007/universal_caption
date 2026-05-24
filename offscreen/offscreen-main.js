console.log('[UC] offscreen-main: loaded');

let audioContext = null;
let sourceNode   = null;
let workletNode  = null;
let silentGain   = null;
let stream       = null;

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Ignore messages not intended for the offscreen document
  if (message.action === 'init-stream') {
    initAudio(message.streamId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('[UC] offscreen-main: initAudio error', err);
        sendResponse({ ok: false, error: err.message });
      });
    return true; // async
  }

  if (message.action === 'stop-stream') {
    stopAudio();
    sendResponse({ ok: true });
  }
});

// ---------------------------------------------------------------------------
// Audio pipeline setup
// ---------------------------------------------------------------------------
async function initAudio(streamId) {
  console.log('[UC] offscreen-main: initAudio(), streamId =', streamId);

  // Acquire the tab's audio stream using the ID supplied by tabCapture
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });
  console.log('[UC] offscreen-main: getUserMedia() resolved',
    '| tracks:', stream.getAudioTracks().length,
    '| active:', stream.active);

  // 16 kHz is sufficient for speech ASR and halves buffer sizes vs 44.1 kHz
  audioContext = new AudioContext({ sampleRate: 16_000 });
  console.log('[UC] offscreen-main: AudioContext created',
    '| sampleRate:', audioContext.sampleRate,
    '| state:', audioContext.state);

  // Load the AudioWorklet processor module (must be an absolute extension URL)
  await audioContext.audioWorklet.addModule(
    chrome.runtime.getURL('offscreen/audio-processor.js'),
  );
  console.log('[UC] offscreen-main: AudioWorklet module registered');

  sourceNode  = audioContext.createMediaStreamSource(stream);
  workletNode = new AudioWorkletNode(audioContext, 'uc-processor');

  // Receive Float32 PCM chunks from the audio rendering thread
  workletNode.port.onmessage = (event) => {
    const chunk = /** @type {Float32Array} */ (event.data);
    console.log(
      '[UC] offscreen-main: PCM chunk',
      '| length:', chunk.length,
      '| first 10:', Array.from(chunk.subarray(0, 10)).map((v) => v.toFixed(5)),
    );
    // TODO: accumulate chunks and forward to ASR engine
  };

  // A GainNode at 0 keeps the audio graph alive without playing back to speakers.
  // Without a path to destination, Web Audio may refuse to process the worklet.
  silentGain = audioContext.createGain();
  silentGain.gain.value = 0;

  sourceNode.connect(workletNode);
  workletNode.connect(silentGain);
  silentGain.connect(audioContext.destination);

  console.log('[UC] offscreen-main: audio pipeline connected — PCM flowing');
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------
function stopAudio() {
  console.log('[UC] offscreen-main: stopAudio()');
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
  console.log('[UC] offscreen-main: audio pipeline torn down');
}
