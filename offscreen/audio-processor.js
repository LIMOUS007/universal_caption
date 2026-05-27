// AudioWorklet processor module — runs on the audio rendering thread.
// No DOM, no Chrome APIs, no import/require available in this scope.

class UCProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
    this._TARGET = 32000; // 2s at 16kHz
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch?.length) return true;
    for (let i = 0; i < ch.length; i++) this._buf.push(ch[i]);
    if (this._buf.length >= this._TARGET) {
      this.port.postMessage(new Float32Array(this._buf.splice(0, this._TARGET)));
    }
    return true;
  }
}

registerProcessor('uc-processor', UCProcessor);
