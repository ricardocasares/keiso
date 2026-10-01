import { Array, Cause, Effect, Option, Queue, Stream } from 'effect'

import { MidiInput, MidiSignal } from './domain/midi'
import { Message } from './message'

export const parseMidiSignal = (
  inputId: string,
  inputName: string,
  data: ReadonlyArray<number> | Uint8Array,
): Option.Option<MidiSignal> => {
  const status = data[0] ?? -1
  const number = data[1] ?? -1
  const value = data[2] ?? -1
  if (
    data.length !== 3 ||
    !Number.isInteger(status) ||
    status < 0x80 ||
    status > 0xff ||
    !Number.isInteger(number) ||
    number < 0 ||
    number > 127 ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 127
  ) {
    return Option.none()
  }
  const kind = status & 0xf0
  if (kind !== 0xb0 && kind !== 0x90 && kind !== 0x80) {
    return Option.none()
  }
  return Option.some({
    source: {
      inputId,
      inputName,
      kind: kind === 0xb0 ? 'cc' : 'note',
      channel: (status & 0x0f) + 1,
      number,
    },
    value: kind === 0x80 ? 0 : value,
  })
}

const midiReason = (error: unknown): string => {
  if (
    error instanceof Error &&
    (error.name === 'NotAllowedError' || error.name === 'SecurityError')
  ) {
    return 'MIDI access was denied. Allow MIDI in your browser settings and try again.'
  }
  return error instanceof Error ? error.message : String(error)
}

const inputName = (input: MIDIInput): string =>
  input.name?.trim() || input.manufacturer?.trim() || 'MIDI input'

const connectedInputs = (access: MIDIAccess): ReadonlyArray<MIDIInput> =>
  Array.fromIterable(access.inputs.values()).filter(
    input => input.state === 'connected',
  )

const describeInputs = (access: MIDIAccess): ReadonlyArray<MidiInput> =>
  connectedInputs(access).map(input => ({
    id: input.id,
    name: inputName(input),
  }))

const closeInput = (input: MIDIInput): Promise<void> =>
  Promise.resolve()
    .then(() => input.close())
    .then(() => undefined)
    .catch(() => undefined)

export const streamMidi = (sessionId: number) =>
  Stream.callback<
    | typeof Message.SucceededStartMidi.Type
    | typeof Message.UpdatedMidiInputs.Type
    | typeof Message.ReceivedMidiSignal.Type,
    string
  >(queue =>
    Effect.gen(function* () {
      const access = yield* Effect.tryPromise({
        try: () => {
          if (globalThis.isSecureContext === false) {
            throw new Error('MIDI input requires HTTPS or localhost.')
          }
          if (
            typeof navigator === 'undefined' ||
            !navigator.requestMIDIAccess
          ) {
            throw new Error(
              'MIDI input is unavailable in this browser. Try a browser with Web MIDI support, such as Chrome.',
            )
          }
          return navigator.requestMIDIAccess({ sysex: false })
        },
        catch: midiReason,
      })
      const listeners = new Map<MIDIInput, (event: MIDIMessageEvent) => void>()
      let active = true
      const fail = (error: unknown) => {
        if (active) {
          Queue.failCauseUnsafe(queue, Cause.fail(midiReason(error)))
        }
      }
      const detach = (input: MIDIInput) => {
        const listener = listeners.get(input)
        if (listener) {
          input.removeEventListener('midimessage', listener)
          listeners.delete(input)
        }
        return closeInput(input)
      }
      const reconcile = async () => {
        const inputs = connectedInputs(access)
        const removed = Array.fromIterable(listeners.keys()).filter(
          input => !inputs.includes(input),
        )
        const closing = removed.map(detach)
        const added = inputs
          .filter(input => !listeners.has(input))
          .map(input => {
            const listener = (event: MIDIMessageEvent) => {
              if (!active || input.state !== 'connected' || !event.data) {
                return
              }
              Option.match(
                parseMidiSignal(input.id, inputName(input), event.data),
                {
                  onNone: () => undefined,
                  onSome: signal =>
                    Queue.offerUnsafe(
                      queue,
                      Message.ReceivedMidiSignal({ sessionId, signal }),
                    ),
                },
              )
            }
            listeners.set(input, listener)
            input.addEventListener('midimessage', listener)
            return input
          })
        const opening = added.map(input =>
          input.open().then(() => {
            if (!active || !listeners.has(input)) {
              return closeInput(input)
            }
          }),
        )
        await Promise.all([...closing, ...opening])
        return Array.isArrayNonEmpty(removed) || Array.isArrayNonEmpty(added)
      }
      const changed = () => {
        reconcile()
          .then(inputsChanged => {
            if (active && inputsChanged) {
              Queue.offerUnsafe(
                queue,
                Message.UpdatedMidiInputs({
                  sessionId,
                  inputs: describeInputs(access),
                }),
              )
            }
          })
          .catch(fail)
      }
      yield* Effect.acquireRelease(
        Effect.sync(() => access.addEventListener('statechange', changed)),
        () =>
          Effect.tryPromise(() => {
            active = false
            access.removeEventListener('statechange', changed)
            return Promise.all(Array.fromIterable(listeners.keys()).map(detach))
          }).pipe(Effect.catch(() => Effect.void)),
      )
      yield* Effect.tryPromise({ try: reconcile, catch: midiReason })
      Queue.offerUnsafe(
        queue,
        Message.SucceededStartMidi({
          sessionId,
          inputs: describeInputs(access),
        }),
      )
      return yield* Effect.never
    }).pipe(Effect.catch(reason => Queue.fail(queue, reason))),
  ).pipe(
    Stream.catch(reason =>
      Stream.make(Message.FailedMidi({ sessionId, reason })),
    ),
  )
