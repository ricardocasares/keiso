import { Effect, Option, Stream } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { afterEach, expect, test, vi } from 'vitest'

import { Snapshot } from './domain/session'
import { parseControls } from './domain/shader'
import { init } from './main'
import { Message } from './message'
import { EngineState, type Model, SavedPerformance } from './model'
import {
  PERFORMANCE_STORAGE_KEY,
  loadPerformance,
  samePerformanceSettings,
  savePerformance,
} from './persistence'
import { subscriptions } from './subscription'

const source =
  '// @slider speed 0 10 2 0.1\n// @color tint #224466\n// @slider bounce 0 1 0.5 0.01'
const performance = SavedPerformance.make({
  sessionId: 'live-session',
  snapshot: Snapshot.make({
    source,
    controls: parseControls(source).controls,
    startedAt: 1000,
    revision: 7,
  }),
  microphoneBindings: [
    { name: 'speed', bands: [0, 1, 2], gain: 2, maybeColor: Option.none() },
  ],
  oscillatorBindings: [
    {
      name: 'tint',
      waveform: 'triangle',
      period: 8,
      depth: 75,
      phase: 90,
      maybeColor: Option.some(0x224466),
    },
  ],
  midiBindings: [
    {
      name: 'bounce',
      maybeSource: Option.some({
        inputId: 'keyboard',
        inputName: 'Keyboard',
        kind: 'cc',
        channel: 2,
        number: 17,
      }),
      maybePendingValue: Option.none(),
      maybeColor: Option.none(),
    },
  ],
  isMicrophoneEnabled: true,
})

const withValue = (value: number) =>
  modifyFields(performance, {
    snapshot: snapshot =>
      modifyFields(snapshot, {
        revision: () => 10 + Math.round(value * 10),
        controls: controls =>
          controls.map(control =>
            control.name === 'speed'
              ? modifyFields(control, { value: () => value })
              : control,
          ),
      }),
  })

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

test('storage round-trips the live shader, clock, controls, and all input bindings', async () => {
  expect(await Effect.runPromise(savePerformance(performance))).toEqual(
    Message.CompletedSavePerformance(),
  )
  expect(await Effect.runPromise(loadPerformance)).toEqual(
    Option.some(performance),
  )
  expect(
    Object.keys(
      JSON.parse(localStorage.getItem(PERFORMANCE_STORAGE_KEY) ?? '{}'),
    ).sort(),
  ).toEqual([
    'isMicrophoneEnabled',
    'microphoneBindings',
    'midiBindings',
    'oscillatorBindings',
    'sessionId',
    'snapshot',
  ])
})

test.each([undefined, '{not-json', '{}', '{"snapshot":{"source":"broken"}}'])(
  'missing or malformed storage falls back safely (%s)',
  async json => {
    if (json !== undefined) {
      localStorage.setItem(PERFORMANCE_STORAGE_KEY, json)
    }
    expect(await Effect.runPromise(loadPerformance)).toEqual(Option.none())
  },
)

test('unavailable storage cannot crash loading or saving', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => {
      throw new Error('Storage denied')
    },
  })
  try {
    expect(Effect.runSync(loadPerformance)).toEqual(Option.none())
    expect(Effect.runSync(savePerformance(performance))).toEqual(
      Message.FailedSavePerformance({
        reason: 'Could not save the live performance: Storage denied',
      }),
    )
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, 'localStorage', descriptor)
    }
  }
})

test('save triggers ignore live values but react to code and mapping settings', () => {
  const current = Option.some(performance)
  expect(samePerformanceSettings(current, Option.some(withValue(8)))).toBe(true)
  const colorsChanged = modifyFields(performance, {
    microphoneBindings: bindings =>
      bindings.map(binding =>
        modifyFields(binding, { maybeColor: () => Option.some(0xabcdef) }),
      ),
    oscillatorBindings: bindings =>
      bindings.map(binding =>
        modifyFields(binding, { maybeColor: () => Option.some(0xabcdef) }),
      ),
    midiBindings: bindings =>
      bindings.map(binding =>
        modifyFields(binding, {
          maybeColor: () => Option.some(0xabcdef),
          maybePendingValue: () => Option.some(100),
        }),
      ),
  })
  expect(samePerformanceSettings(current, Option.some(colorsChanged))).toBe(
    true,
  )
  const changed = [
    modifyFields(performance, {
      snapshot: snapshot =>
        modifyFields(snapshot, { source: () => source + '\n' }),
    }),
    modifyFields(performance, { microphoneBindings: () => [] }),
    modifyFields(performance, { oscillatorBindings: () => [] }),
    modifyFields(performance, { midiBindings: () => [] }),
    modifyFields(performance, { isMicrophoneEnabled: () => false }),
    modifyFields(performance, {
      microphoneBindings: bindings =>
        bindings.map(binding =>
          modifyFields(binding, { gain: () => 4, bands: () => [5] }),
        ),
    }),
    modifyFields(performance, {
      oscillatorBindings: bindings =>
        bindings.map(binding => modifyFields(binding, { period: () => 12 })),
    }),
  ]
  changed.forEach(next =>
    expect(samePerformanceSettings(current, Option.some(next))).toBe(false),
  )
  expect(samePerformanceSettings(current, Option.none())).toBe(false)
})

test('only a ready controller persists and queued MIDI values remain transient', () => {
  const initial = init({
    mode: 'control',
    sessionId: performance.sessionId,
    startedAt: 2000,
    maybeSavedPerformance: Option.none(),
  }).model
  const live: Model = modifyFields(initial, {
    engine: () => EngineState.Ready(),
    maybeLive: () => Option.some(performance.snapshot),
    midiBindings: () =>
      performance.midiBindings.map(binding =>
        modifyFields(binding, { maybePendingValue: () => Option.some(40) }),
      ),
  })
  const dependencies = subscriptions.performance.modelToDependencies
  expect(dependencies(initial).maybePerformance).toEqual(Option.none())
  expect(
    dependencies(modifyFields(live, { mode: () => 'projection' }))
      .maybePerformance,
  ).toEqual(Option.none())
  expect(
    dependencies(modifyFields(live, { engine: () => EngineState.Starting() }))
      .maybePerformance,
  ).toEqual(Option.none())
  expect(
    Option.getOrThrow(dependencies(live).maybePerformance).midiBindings[0]
      ?.maybePendingValue,
  ).toEqual(Option.none())
})

test('saves once per settings change, without periodic or unload saves for control values', async () => {
  const writes = vi.spyOn(localStorage, 'setItem')
  const settingsChanged = modifyFields(withValue(8), {
    microphoneBindings: bindings =>
      bindings.map(binding => modifyFields(binding, { gain: () => 3 })),
  })
  const subscription = subscriptions.performance
  const messages = await Effect.runPromise(
    Stream.fromArray([
      performance,
      ...Array.from({ length: 20 }, (_, index) => withValue(index / 2)),
      settingsChanged,
      settingsChanged,
    ]).pipe(
      Stream.map(performance => ({
        maybePerformance: Option.some(performance),
      })),
      Stream.changesWith(subscription.keepAliveEquivalence),
      Stream.flatMap(dependencies =>
        subscription.dependenciesToStream(dependencies, () => dependencies),
      ),
      Stream.runCollect,
    ),
  )
  expect(messages).toEqual([
    Message.CompletedSavePerformance(),
    Message.CompletedSavePerformance(),
  ])
  expect(writes).toHaveBeenCalledTimes(2)
  expect(Effect.runSync(loadPerformance)).toEqual(Option.some(settingsChanged))
  window.dispatchEvent(new Event('pagehide'))
  expect(writes).toHaveBeenCalledTimes(2)
})
