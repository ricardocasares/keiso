/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, test, vi } from 'vitest'

type Clock = {
  port: { postMessage: (message: null) => void }
  process: (
    inputs: ReadonlyArray<ReadonlyArray<Float32Array>>,
    outputs: ReadonlyArray<ReadonlyArray<Float32Array>>,
  ) => boolean
}

test.each([44100, 48000])(
  'microphone clock emits 30 ticks per second at %i Hz and outputs silence',
  sampleRate => {
    const registerProcessor =
      vi.fn<(name: string, processor: new () => Clock) => void>()
    runInNewContext(readFileSync('src/microphone-clock.js', 'utf8'), {
      sampleRate,
      registerProcessor,
      AudioWorkletProcessor: class {
        port = { postMessage: vi.fn() }
      },
    })
    expect(registerProcessor).toHaveBeenCalledExactlyOnceWith(
      'microphone-clock',
      expect.any(Function),
    )
    const Processor = registerProcessor.mock.calls[0]?.[1]
    if (!Processor) {
      throw new Error('Microphone clock was not registered')
    }
    const clock = new Processor()
    const input = new Float32Array(128).fill(0.75)
    const output = new Float32Array(128)
    const keepRunning = Array.from(
      { length: Math.ceil(sampleRate / 128) },
      () => clock.process([[input]], [[output]]),
    ).every(Boolean)
    expect(keepRunning).toBe(true)
    expect(clock.port.postMessage).toHaveBeenCalledTimes(30)
    expect(clock.port.postMessage).toHaveBeenCalledWith(null)
    expect(output).toEqual(new Float32Array(128))
  },
)
