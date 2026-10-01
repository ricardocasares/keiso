import { Effect, Fiber, Option, Stream } from 'effect'
import { afterEach, expect, test, vi } from 'vitest'

import { Message } from './message'
import { parseMidiSignal, streamMidi } from './midi'

afterEach(() => vi.unstubAllGlobals())

const fakeInput = (id: string, name: string) => {
  const input = Object.assign(new EventTarget(), {
    id,
    name,
    manufacturer: 'Test device',
    state: 'connected',
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  })
  return {
    input,
    send: (data: ReadonlyArray<number>) =>
      input.dispatchEvent(
        Object.assign(new Event('midimessage'), {
          data: new Uint8Array(data),
        }),
      ),
  }
}

const fakeMidi = () => {
  const keyboard = fakeInput('keyboard', 'Keyboard')
  const access = Object.assign(new EventTarget(), {
    inputs: new Map([[keyboard.input.id, keyboard.input]]),
  })
  const requestMIDIAccess = vi.fn(async () => access)
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('navigator', { requestMIDIAccess })
  return {
    keyboard,
    access,
    requestMIDIAccess,
    changed: () => access.dispatchEvent(new Event('statechange')),
  }
}

test('MIDI parsing handles CC values, note velocity, releases, and channels', () => {
  const source = {
    inputId: 'keys',
    inputName: 'Keys',
    kind: 'cc',
    channel: 1,
    number: 74,
  }
  expect(parseMidiSignal('keys', 'Keys', [0xb0, 74, 127])).toEqual(
    Option.some({ source, value: 127 }),
  )
  expect(
    parseMidiSignal('keys', 'Keys', new Uint8Array([0x9f, 60, 96])),
  ).toEqual(
    Option.some({
      source: {
        inputId: 'keys',
        inputName: 'Keys',
        kind: 'note',
        channel: 16,
        number: 60,
      },
      value: 96,
    }),
  )
  expect(parseMidiSignal('keys', 'Keys', [0x83, 60, 64])).toEqual(
    parseMidiSignal('keys', 'Keys', [0x93, 60, 0]),
  )
  expect(
    Option.getOrThrow(parseMidiSignal('keys', 'Keys', [0x83, 60, 64])).value,
  ).toBe(0)
})

test('MIDI parsing ignores clock, system, unsupported and malformed messages', () => {
  const messages = [
    [0xf8],
    [0xf0, 1, 0xf7],
    [0xe0, 0, 64],
    [0xa0, 60, 96],
    [0xc0, 12],
    [0xd0, 96],
    [0xb0, 74],
    [0xb0, 74, 127, 0],
    [0xb0, 128, 64],
    [0xb0, 74, -1],
    [0xb0, 74, 128],
    [0xb0, 1.5, 64],
    [0xb0, 74, NaN],
    [0xb0, 74, Infinity],
    [0xb0 + 0.1, 74, 64],
    [0x1b0, 74, 64],
    [0x70, 74, 64],
    [],
  ]
  messages.forEach(data =>
    expect(parseMidiSignal('keys', 'Keys', data)).toEqual(Option.none()),
  )
})

test('MIDI inputs learn from messages, hotplug, and release listeners and ports', async () => {
  const midi = fakeMidi()
  const messages: Array<Message> = []
  const fiber = Effect.runFork(
    Stream.runForEach(streamMidi(7), message =>
      Effect.sync(() => {
        messages.push(message)
      }),
    ),
  )
  try {
    await vi.waitFor(() => expect(messages).toHaveLength(1))
    expect(messages[0]).toEqual(
      Message.SucceededStartMidi({
        sessionId: 7,
        inputs: [{ id: 'keyboard', name: 'Keyboard' }],
      }),
    )
    expect(midi.requestMIDIAccess).toHaveBeenCalledExactlyOnceWith({
      sysex: false,
    })
    expect(midi.keyboard.input.open).toHaveBeenCalledOnce()
    midi.keyboard.send([0xf8])
    midi.keyboard.send([0xb2, 74, 48])
    await vi.waitFor(() => expect(messages).toHaveLength(2))
    expect(messages[1]).toEqual(
      Message.ReceivedMidiSignal({
        sessionId: 7,
        signal: Option.getOrThrow(
          parseMidiSignal('keyboard', 'Keyboard', [0xb2, 74, 48]),
        ),
      }),
    )

    const pads = fakeInput('pads', 'Pads')
    midi.access.inputs.set(pads.input.id, pads.input)
    midi.changed()
    await vi.waitFor(() => expect(messages).toHaveLength(3))
    expect(messages[2]).toEqual(
      Message.UpdatedMidiInputs({
        sessionId: 7,
        inputs: [
          { id: 'keyboard', name: 'Keyboard' },
          { id: 'pads', name: 'Pads' },
        ],
      }),
    )
    expect(pads.input.open).toHaveBeenCalledOnce()
    midi.changed()
    await Promise.resolve()
    await Promise.resolve()
    expect(messages).toHaveLength(3)
    pads.send([0x99, 36, 127])
    await vi.waitFor(() => expect(messages).toHaveLength(4))
    midi.keyboard.input.state = 'disconnected'
    midi.access.inputs.delete('keyboard')
    midi.changed()
    await vi.waitFor(() => expect(messages).toHaveLength(5))
    expect(messages[4]).toEqual(
      Message.UpdatedMidiInputs({
        sessionId: 7,
        inputs: [{ id: 'pads', name: 'Pads' }],
      }),
    )
    expect(midi.keyboard.input.close).toHaveBeenCalledOnce()
    midi.keyboard.send([0xb2, 74, 99])
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(pads.input.close).toHaveBeenCalledOnce()
    expect(midi.keyboard.input.close).toHaveBeenCalledOnce()
    pads.send([0x99, 36, 127])
    const lateInput = fakeInput('late', 'Late input')
    midi.access.inputs.set(lateInput.input.id, lateInput.input)
    midi.changed()
    await Promise.resolve()
    expect(messages).toHaveLength(5)
    expect(lateInput.input.open).not.toHaveBeenCalled()
  } finally {
    await Effect.runPromise(Fiber.interrupt(fiber))
  }
})

test.each(['NotAllowedError', 'SecurityError'])(
  '%s MIDI permission denial becomes a recoverable message',
  async name => {
    const midi = fakeMidi()
    midi.requestMIDIAccess.mockRejectedValue(new DOMException('Denied', name))
    const messages = await Effect.runPromise(Stream.runCollect(streamMidi(8)))
    expect(messages).toEqual([
      Message.FailedMidi({
        sessionId: 8,
        reason:
          'MIDI access was denied. Allow MIDI in your browser settings and try again.',
      }),
    ])
    expect(midi.keyboard.input.open).not.toHaveBeenCalled()
  },
)

test.each(['insecure', 'unsupported'])(
  '%s MIDI access reports the browser requirement without requesting permission',
  async requirement => {
    const midi = fakeMidi()
    if (requirement === 'insecure') {
      vi.stubGlobal('isSecureContext', false)
    } else {
      vi.stubGlobal('navigator', {})
    }
    const messages = await Effect.runPromise(Stream.runCollect(streamMidi(9)))
    expect(messages).toEqual([
      Message.FailedMidi({
        sessionId: 9,
        reason:
          requirement === 'insecure'
            ? 'MIDI input requires HTTPS or localhost.'
            : 'MIDI input is unavailable in this browser. Try a browser with Web MIDI support, such as Chrome.',
      }),
    ])
    expect(midi.requestMIDIAccess).not.toHaveBeenCalled()
  },
)

test('an input opening failure removes listeners and closes inputs', async () => {
  const midi = fakeMidi()
  midi.keyboard.input.open.mockRejectedValue(new Error('MIDI input is busy'))
  const messages = await Effect.runPromise(Stream.runCollect(streamMidi(10)))
  expect(messages).toEqual([
    Message.FailedMidi({ sessionId: 10, reason: 'MIDI input is busy' }),
  ])
  expect(midi.keyboard.input.close).toHaveBeenCalledOnce()
})

test('a permission grant after cancellation cannot open MIDI inputs', async () => {
  const midi = fakeMidi()
  let grant: (access: typeof midi.access) => void = () => undefined
  midi.requestMIDIAccess.mockImplementation(
    () =>
      new Promise(resolve => {
        grant = resolve
      }),
  )
  const fiber = Effect.runFork(Stream.runDrain(streamMidi(11)))
  await vi.waitFor(() => expect(midi.requestMIDIAccess).toHaveBeenCalledOnce())
  await Effect.runPromise(Fiber.interrupt(fiber))
  grant(midi.access)
  await Promise.resolve()
  await Promise.resolve()
  midi.changed()
  expect(midi.keyboard.input.open).not.toHaveBeenCalled()
  expect(midi.keyboard.input.close).not.toHaveBeenCalled()
})

test('an input opening after cancellation is closed again', async () => {
  const midi = fakeMidi()
  let finishOpening: () => void = () => undefined
  midi.keyboard.input.open.mockImplementation(
    () =>
      new Promise(resolve => {
        finishOpening = () => resolve(undefined)
      }),
  )
  const fiber = Effect.runFork(Stream.runDrain(streamMidi(12)))
  await vi.waitFor(() =>
    expect(midi.keyboard.input.open).toHaveBeenCalledOnce(),
  )
  await Effect.runPromise(Fiber.interrupt(fiber))
  expect(midi.keyboard.input.close).toHaveBeenCalledOnce()
  finishOpening()
  await vi.waitFor(() =>
    expect(midi.keyboard.input.close).toHaveBeenCalledTimes(2),
  )
})
