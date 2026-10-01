import { Effect, Fiber, Stream } from 'effect'
import { afterEach, expect, test, vi } from 'vitest'

import {
  bandLevel,
  bandsInRange,
  spectrumBands,
  streamMicrophone,
} from './audio'
import { Message } from './message'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const fakeAudio = () => {
  const track = Object.assign(new EventTarget(), {
    readyState: 'live',
    stop: vi.fn(() => {
      track.readyState = 'ended'
    }),
  })
  const microphone = { getTracks: () => [track], getAudioTracks: () => [track] }
  const analyser = {
    fftSize: 8192,
    frequencyBinCount: 4096,
    smoothingTimeConstant: 0,
    getByteFrequencyData: vi.fn((values: Uint8Array) => values.fill(128)),
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
  const source = { connect: vi.fn(), disconnect: vi.fn() }
  const port: { onmessage: (() => void) | null; close: () => void } = {
    onmessage: null,
    close: vi.fn(),
  }
  const clock: {
    port: typeof port
    onprocessorerror: (() => void) | null
    connect: (destination: unknown) => void
    disconnect: () => void
  } = { port, onprocessorerror: null, connect: vi.fn(), disconnect: vi.fn() }
  const context = Object.assign(new EventTarget(), {
    state: 'running',
    sampleRate: 48000,
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => {
      context.state = 'closed'
    }),
    createAnalyser: () => analyser,
    createMediaStreamSource: () => source,
    audioWorklet: { addModule: vi.fn(async () => undefined) },
    destination: {},
  })
  const createClock = vi.fn()
  const getUserMedia = vi.fn(async () => microphone)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        return context
      }
    },
  )
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      constructor(...args: ReadonlyArray<unknown>) {
        createClock(...args)
        return clock
      }
    },
  )
  return {
    track,
    microphone,
    analyser,
    source,
    context,
    getUserMedia,
    clock,
    port,
    createClock,
    tick: () => port.onmessage?.(),
  }
}

test('band presets overlap frequency ranges and levels isolate bass with clamped sensitivity', () => {
  const bass = spectrumBands.map(band => (band.low < 250 ? 0.5 : 0))
  expect(spectrumBands).toHaveLength(64)
  expect(spectrumBands[0]?.low).toBe(20)
  expect(spectrumBands[63]?.high).toBe(20000)
  expect(bandsInRange(20, 20000)).toEqual(
    spectrumBands.map((_, index) => index),
  )
  expect(bandsInRange(20, 21)).toEqual([0])
  expect(bandsInRange(250, 20)).toEqual([])
  expect(bandsInRange(20000, 22000)).toEqual([])
  expect(bandsInRange(NaN, 250)).toEqual([])
  expect(bandLevel(bass, bandsInRange(20, 250), 1)).toBeCloseTo(0.5)
  expect(bandLevel(bass, bandsInRange(1000, 4000), 1)).toBe(0)
  expect(bandLevel(bass, bandsInRange(20, 250), 4)).toBe(1)
  expect(bandLevel(bass, [0], Infinity)).toBe(0)
  expect(bandLevel(bass, [0], -1)).toBe(0)
})

test('disjoint selections ignore intervening energy, empty selections, and invalid indices', () => {
  expect(bandLevel([0.25, 1, 0.25], [0, 2], 1)).toBeCloseTo(0.25)
  expect(bandLevel([0, 1, 0], [0, 2], 1)).toBe(0)
  expect(bandLevel([1, 1, 1], [], 1)).toBe(0)
  expect(bandLevel([], [0, 2], 1)).toBe(0)
  expect(bandLevel([NaN, Infinity], [0, 1], 1)).toBe(0)
  expect(bandLevel([1], [-1, 0.5, 64, NaN, Infinity], 1)).toBe(0)
  expect(bandLevel([0.2, 1, 0.6], [0, 0, 2, -1, 0.5, 64], 1)).toBe(
    bandLevel([0.2, 1, 0.6], [0, 2], 1),
  )
})

test('worklet ticks stream a normalized spectrum without page timers and stop every resource', async () => {
  const audio = fakeAudio()
  const fiber = Effect.runFork(
    streamMicrophone(7).pipe(Stream.take(2), Stream.runCollect),
  )
  try {
    await vi.waitFor(() => expect(audio.port.onmessage).toBeTypeOf('function'))
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] })
    audio.tick()
    const messages = await Effect.runPromise(Fiber.join(fiber))
    expect(messages[0]).toEqual(
      Message.SucceededStartMicrophone({ sessionId: 7 }),
    )
    expect(messages[1]).toEqual({
      _tag: 'UpdatedMicrophoneSpectrum',
      sessionId: 7,
      spectrum: spectrumBands.map(() => expect.closeTo(128 / 255, 8)),
    })
    expect(audio.getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
    expect(audio.source.connect).toHaveBeenCalledExactlyOnceWith(audio.analyser)
    expect(audio.context.audioWorklet.addModule).toHaveBeenCalledWith(
      expect.stringContaining('/microphone-clock.js'),
    )
    expect(audio.createClock).toHaveBeenCalledExactlyOnceWith(
      audio.context,
      'microphone-clock',
      { outputChannelCount: [1] },
    )
    expect(audio.analyser.connect).toHaveBeenCalledExactlyOnceWith(audio.clock)
    expect(audio.clock.connect).toHaveBeenCalledExactlyOnceWith(
      audio.context.destination,
    )
    expect(audio.source.disconnect).toHaveBeenCalledOnce()
    expect(audio.analyser.disconnect).toHaveBeenCalledOnce()
    expect(audio.clock.disconnect).toHaveBeenCalledOnce()
    expect(audio.port.close).toHaveBeenCalledOnce()
    expect(audio.port.onmessage).toBeNull()
    expect(audio.clock.onprocessorerror).toBeNull()
    expect(audio.track.stop).toHaveBeenCalledOnce()
    expect(audio.context.close).toHaveBeenCalledOnce()
    audio.tick()
    expect(audio.analyser.getByteFrequencyData).toHaveBeenCalledOnce()
  } finally {
    vi.useRealTimers()
    await Effect.runPromise(Fiber.interrupt(fiber))
  }
})

test('permission denial becomes a recoverable message and closes the audio context', async () => {
  const audio = fakeAudio()
  audio.getUserMedia.mockRejectedValue(
    new DOMException('Denied', 'NotAllowedError'),
  )
  const messages = await Effect.runPromise(
    Stream.runCollect(streamMicrophone(8)),
  )
  expect(messages).toEqual([
    Message.FailedMicrophone({
      sessionId: 8,
      reason:
        'Microphone access was denied. Allow access in your browser and try again.',
    }),
  ])
  expect(audio.context.close).toHaveBeenCalledOnce()
})

test('a failed worklet module reports the error and releases the microphone', async () => {
  const audio = fakeAudio()
  audio.context.audioWorklet.addModule.mockRejectedValue(
    new Error('Audio module could not load'),
  )
  const messages = await Effect.runPromise(
    Stream.runCollect(streamMicrophone(8)),
  )
  expect(messages).toEqual([
    Message.FailedMicrophone({
      sessionId: 8,
      reason: 'Audio module could not load',
    }),
  ])
  expect(audio.track.stop).toHaveBeenCalledOnce()
  expect(audio.context.close).toHaveBeenCalledOnce()
  expect(audio.createClock).not.toHaveBeenCalled()
})

test('a microphone granted after cancellation is immediately stopped', async () => {
  const audio = fakeAudio()
  let grant: (microphone: typeof audio.microphone) => void = () => undefined
  audio.getUserMedia.mockImplementation(
    () =>
      new Promise(resolve => {
        grant = resolve
      }),
  )
  const fiber = Effect.runFork(Stream.runDrain(streamMicrophone(9)))
  await vi.waitFor(() => expect(audio.getUserMedia).toHaveBeenCalledOnce())
  await Effect.runPromise(Fiber.interrupt(fiber))
  expect(audio.context.close).toHaveBeenCalledOnce()
  grant(audio.microphone)
  await vi.waitFor(() => expect(audio.track.stop).toHaveBeenCalledOnce())
})

test('a worklet module resolving after cancellation cannot restart microphone capture', async () => {
  const audio = fakeAudio()
  let finishModule: () => void = () => undefined
  audio.context.audioWorklet.addModule.mockImplementation(
    () =>
      new Promise(resolve => {
        finishModule = () => resolve(undefined)
      }),
  )
  const fiber = Effect.runFork(Stream.runDrain(streamMicrophone(9)))
  await vi.waitFor(() =>
    expect(audio.context.audioWorklet.addModule).toHaveBeenCalledOnce(),
  )
  await Effect.runPromise(Fiber.interrupt(fiber))
  expect(audio.track.stop).toHaveBeenCalledOnce()
  expect(audio.context.close).toHaveBeenCalledOnce()
  finishModule()
  await Promise.resolve()
  await Promise.resolve()
  expect(audio.createClock).not.toHaveBeenCalled()
  expect(audio.source.connect).not.toHaveBeenCalled()
})

test.each(['disconnected', 'suspended', 'processor'])(
  '%s microphone input fails and releases capture',
  async failure => {
    const audio = fakeAudio()
    const messages: Array<Message> = []
    const fiber = Effect.runFork(
      Stream.runForEach(streamMicrophone(10), message =>
        Effect.sync(() => {
          messages.push(message)
        }),
      ),
    )
    try {
      await vi.waitFor(() =>
        expect(
          messages.some(message => message._tag === 'SucceededStartMicrophone'),
        ).toBe(true),
      )
      if (failure === 'disconnected') {
        audio.track.readyState = 'ended'
        audio.track.dispatchEvent(new Event('ended'))
      } else if (failure === 'suspended') {
        audio.context.state = 'suspended'
        audio.context.dispatchEvent(new Event('statechange'))
      } else {
        audio.clock.onprocessorerror?.()
      }
      await vi.waitFor(() =>
        expect(messages.at(-1)?._tag).toBe('FailedMicrophone'),
      )
      expect(audio.track.stop).toHaveBeenCalledOnce()
      expect(audio.context.close).toHaveBeenCalledOnce()
      expect(audio.analyser.getByteFrequencyData).not.toHaveBeenCalled()
      expect(audio.port.close).toHaveBeenCalledOnce()
      expect(audio.source.disconnect).toHaveBeenCalledOnce()
      expect(audio.analyser.disconnect).toHaveBeenCalledOnce()
      expect(audio.clock.disconnect).toHaveBeenCalledOnce()
      expect(audio.port.onmessage).toBeNull()
      expect(audio.clock.onprocessorerror).toBeNull()
    } finally {
      await Effect.runPromise(Fiber.interrupt(fiber))
    }
  },
)
