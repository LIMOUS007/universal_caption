// AudioWorklet processor module — runs on the audio rendering thread.
// No DOM, no Chrome APIs, no import/require available in this scope.

class UCProcessor extends AudioWorkletProcessor {
  process(inputs, _outputs, _parameters) {
    const channel = inputs[0]?.[0]; // first input port, left/mono channel
    if (channel?.length) {
      // slice() copies the data out of the shared buffer before it is recycled
      this.port.postMessage(channel.slice());
    }
    // Returning true keeps the processor alive indefinitely
    return true;
  }
}

registerProcessor('uc-processor', UCProcessor);
