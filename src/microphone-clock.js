class MicrophoneClock extends AudioWorkletProcessor {
  frames = 0

  process(_inputs, outputs) {
    // NOTE: Leave the zero-filled output silent; never monitor the mic through speakers.
    this.frames += outputs[0][0].length
    if (this.frames >= sampleRate / 30) {
      this.frames %= sampleRate / 30
      this.port.postMessage(null)
    }
    return true
  }
}

registerProcessor('microphone-clock', MicrophoneClock)
