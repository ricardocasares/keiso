import { Cause, Effect, Option, Schema, Struct } from 'effect'
import { KeyValueStore } from 'effect/unstable/persistence'

import { BrowserKeyValueStore } from '@effect/platform-browser'

import { MidiBinding } from './domain/midi'
import { errorReason } from './host'
import { Message } from './message'
import { MicrophoneBinding, OscillatorBinding, SavedPerformance } from './model'

export const PERFORMANCE_STORAGE_KEY = 'keiso:performance:v1'
export const SavedPerformanceJsonString = Schema.fromJsonString(
  Schema.toCodecJson(SavedPerformance),
)

export const loadPerformance = Effect.gen(function* () {
  const store = yield* KeyValueStore.KeyValueStore
  const json = yield* Effect.fromOption(
    Option.fromNullishOr(yield* store.get(PERFORMANCE_STORAGE_KEY)),
  )
  return Option.some(
    yield* Schema.decodeEffect(SavedPerformanceJsonString)(json),
  )
}).pipe(
  Effect.provide(BrowserKeyValueStore.layerLocalStorage),
  Effect.catchCause(() => Effect.succeed(Option.none<SavedPerformance>())),
)

export const savePerformance = (performance: SavedPerformance) =>
  Effect.gen(function* () {
    const store = yield* KeyValueStore.KeyValueStore
    const json = yield* Schema.encodeEffect(SavedPerformanceJsonString)(
      performance,
    )
    yield* store.set(PERFORMANCE_STORAGE_KEY, json)
    return Message.CompletedSavePerformance()
  }).pipe(
    Effect.provide(BrowserKeyValueStore.layerLocalStorage),
    Effect.catchCause(cause =>
      Effect.succeed(
        Message.FailedSavePerformance({
          reason: `Could not save the live performance: ${errorReason(Cause.squash(cause))}`,
        }),
      ),
    ),
  )

const sameMicrophoneBindings = Schema.toEquivalence(
  Schema.Array(MicrophoneBinding.mapFields(Struct.omit(['maybeColor']))),
)
const sameOscillatorBindings = Schema.toEquivalence(
  Schema.Array(OscillatorBinding.mapFields(Struct.omit(['maybeColor']))),
)
const sameMidiBindings = Schema.toEquivalence(
  Schema.Array(
    MidiBinding.mapFields(Struct.omit(['maybeColor', 'maybePendingValue'])),
  ),
)

export const samePerformanceSettings = (
  first: Option.Option<SavedPerformance>,
  second: Option.Option<SavedPerformance>,
): boolean =>
  Option.isNone(first) || Option.isNone(second)
    ? Option.isNone(first) && Option.isNone(second)
    : first.value.sessionId === second.value.sessionId &&
      first.value.snapshot.source === second.value.snapshot.source &&
      first.value.snapshot.startedAt === second.value.snapshot.startedAt &&
      first.value.isMicrophoneEnabled === second.value.isMicrophoneEnabled &&
      sameMicrophoneBindings(
        first.value.microphoneBindings,
        second.value.microphoneBindings,
      ) &&
      sameOscillatorBindings(
        first.value.oscillatorBindings,
        second.value.oscillatorBindings,
      ) &&
      sameMidiBindings(first.value.midiBindings, second.value.midiBindings)
