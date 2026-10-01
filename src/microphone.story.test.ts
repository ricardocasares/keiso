import { Array, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { bandsInRange, spectrumBands } from './audio'
import { Broadcast, Snapshot } from './domain/session'
import { type Diagnostic, parseControls } from './domain/shader'
import { shaderExamples } from './examples'
import {
  BroadcastState,
  FocusControlInput,
  RenderShader,
  ShowDiagnostics,
  SyncControls,
  init,
  update,
} from './main'
import { Message } from './message'
import {
  EngineState,
  MicrophoneState,
  RenderState,
  SpectrumDrag,
} from './model'
import { subscriptions } from './subscription'

const initialModel = init({
  mode: 'control',
  sessionId: 'microphone-test',
  startedAt: 1000,
}).model
const snapshot = Snapshot.make({
  source: initialModel.source,
  controls: parseControls(initialModel.source).controls,
  startedAt: initialModel.startedAt,
  revision: 1,
})
const liveModel = modifyFields(initialModel, {
  engine: () => EngineState.Ready(),
  maybeLive: () => Option.some(snapshot),
})
const readyModel = modifyFields(liveModel, {
  microphone: () => MicrophoneState.Ready(),
  microphoneSession: () => 1,
  microphoneBindings: () => [
    {
      name: 'speed',
      bands: bandsInRange(20, 250),
      gain: 1,
      maybeColor: Option.none(),
    },
    {
      name: 'intensity',
      bands: bandsInRange(20, 250),
      gain: 1,
      maybeColor: Option.none(),
    },
  ],
})
const spectrum = (level: number) => spectrumBands.map(() => level)
const frame = (level: number) =>
  Message.UpdatedMicrophoneSpectrum({ sessionId: 1, spectrum: spectrum(level) })
const changedSnapshot = (speed: number, intensity: number, revision: number) =>
  modifyFields(snapshot, {
    controls: controls =>
      controls.map(control =>
        control.name === 'speed' || control.name === 'intensity'
          ? modifyFields(control, {
              value: () => (control.name === 'speed' ? speed : intensity),
            })
          : control,
      ),
    revision: () => revision,
  })
const synchronized = (snapshot: Snapshot) =>
  Command.expectExact(
    SyncControls({ snapshot }),
    BroadcastState({ broadcast: Broadcast.State({ snapshot }) }),
  )
const acknowledgeControls = Command.resolveAll(
  [SyncControls, Message.CompletedSyncControls()],
  [BroadcastState, Message.CompletedBroadcastState()],
)

describe('microphone control bindings', () => {
  test('example bindings install only after successful entry and preserve manual changes on rerender', () => {
    const example = Option.getOrThrow(
      Array.findFirst(shaderExamples, example => example.id === 'afterhours'),
    )
    const bindings = Option.getOrThrow(
      Option.fromNullishOr(example.microphoneBindings),
    )
    const exampleSnapshot = modifyFields(snapshot, {
      source: () => example.source,
      controls: () => parseControls(example.source).controls,
      revision: () => 2,
    })
    const rerenderedSnapshot = modifyFields(exampleSnapshot, {
      revision: () => 3,
    })
    const diagnostics: ReadonlyArray<Diagnostic> = [
      {
        id: 'validation-error',
        line: 1,
        column: 1,
        severity: 'error',
        message: 'Render rejected',
      },
    ]
    const acknowledgeRender = Command.resolveAll(
      [BroadcastState, Message.CompletedBroadcastState()],
      [ShowDiagnostics, Message.CompletedShowDiagnostics()],
    )
    story(
      update,
      given(
        modifyFields(liveModel, {
          source: () => example.source,
          microphoneBindings: () => readyModel.microphoneBindings,
        }),
      ),
      message(Message.PressedRender()),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({
          snapshot: exampleSnapshot,
          diagnostics,
        }),
      ),
      Command.resolve(ShowDiagnostics, Message.CompletedShowDiagnostics()),
      model(model => {
        expect(model.maybeLive).toStrictEqual(Option.some(snapshot))
        expect(model.microphoneBindings).toStrictEqual(
          readyModel.microphoneBindings,
        )
      }),
      message(Message.PressedRender()),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({
          snapshot: exampleSnapshot,
          diagnostics: [],
        }),
      ),
      acknowledgeRender,
      model(model => {
        expect(model.microphoneBindings).toStrictEqual(bindings)
        expect(model.maybeSelectedControl).toStrictEqual(Option.some('bass'))
        expect(model.microphone._tag).toBe('Idle')
        expect(model.microphoneSession).toBe(0)
        expect(subscriptions.microphone.modelToDependencies(model)).toEqual({
          maybeSession: Option.none(),
        })
      }),
      message(Message.SelectedControlInput({ name: 'bass', input: 'manual' })),
      message(Message.UpdatedControlGain({ name: 'mids', gain: 4 })),
      message(Message.UpdatedSource({ source: example.source })),
      message(Message.PressedRender()),
      Command.expectExact(RenderShader({ snapshot: rerenderedSnapshot })),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({
          snapshot: rerenderedSnapshot,
          diagnostics: [],
        }),
      ),
      acknowledgeRender,
      model(model => {
        expect(model.microphoneBindings).toStrictEqual(
          bindings
            .filter(binding => binding.name !== 'bass')
            .map(binding =>
              binding.name === 'mids'
                ? modifyFields(binding, { gain: () => 4 })
                : binding,
            ),
        )
        expect(model.microphone._tag).toBe('Idle')
      }),
      Command.expectNone(),
    )
  })

  test('selecting a live control binds bass without requesting the microphone', () => {
    story(
      update,
      given(liveModel),
      message(Message.ClickedControlInput({ name: 'missing' })),
      message(
        Message.SelectedControlInput({ name: 'missing', input: 'microphone' }),
      ),
      model(model => expect(model).toStrictEqual(liveModel)),
      message(Message.ClickedControlInput({ name: 'speed' })),
      message(
        Message.SelectedControlInput({ name: 'speed', input: 'microphone' }),
      ),
      message(
        Message.SelectedControlInput({ name: 'speed', input: 'microphone' }),
      ),
      Command.expectNone(),
      model(model => {
        expect(model.maybeSelectedControl).toStrictEqual(Option.some('speed'))
        expect(model.microphoneBindings).toEqual([
          {
            name: 'speed',
            bands: bandsInRange(20, 250),
            gain: 1,
            maybeColor: Option.none(),
          },
        ])
        expect(subscriptions.microphone.modelToDependencies(model)).toEqual({
          maybeSession: Option.none(),
        })
      }),
      message(Message.ClickedStartMicrophone()),
      model(model => {
        expect(model.microphone._tag).toBe('Starting')
        expect(subscriptions.microphone.modelToDependencies(model)).toEqual({
          maybeSession: Option.some(1),
        })
      }),
      message(Message.SucceededStartMicrophone({ sessionId: 1 })),
      model(model => expect(model.microphone._tag).toBe('Ready')),
    )
  })

  test('distant bars toggle independently, empty selection uses the minimum, and presets preserve outside bands', () => {
    story(
      update,
      given(
        modifyFields(readyModel, {
          microphoneBindings: () => [
            { name: 'speed', bands: [], gain: 1, maybeColor: Option.none() },
          ],
        }),
      ),
      message(Message.ClickedSpectrumBand({ name: 'speed', index: 2 })),
      message(Message.ClickedSpectrumBand({ name: 'speed', index: 50 })),
      message(Message.ClickedSpectrumBand({ name: 'speed', index: -1 })),
      message(
        Message.ClickedSpectrumBand({
          name: 'speed',
          index: spectrumBands.length,
        }),
      ),
      message(Message.ClickedSpectrumBand({ name: 'speed', index: 2.5 })),
      message(
        Message.ClickedSpectrumBand({ name: 'speed', index: Number.NaN }),
      ),
      model(model =>
        expect(model.microphoneBindings).toEqual([
          { name: 'speed', bands: [2, 50], gain: 1, maybeColor: Option.none() },
        ]),
      ),
      message(
        Message.UpdatedMicrophoneSpectrum({
          sessionId: 1,
          spectrum: spectrumBands.map((_, index) =>
            index === 2 || index === 50 ? 0.5 : 1,
          ),
        }),
      ),
      synchronized(changedSnapshot(1.5, 1.1, 2)),
      acknowledgeControls,
      message(Message.ClickedSpectrumBand({ name: 'speed', index: 2 })),
      model(model =>
        expect(model.microphoneBindings).toEqual([
          { name: 'speed', bands: [50], gain: 1, maybeColor: Option.none() },
        ]),
      ),
      message(
        Message.UpdatedMicrophoneSpectrum({
          sessionId: 1,
          spectrum: spectrumBands.map((_, index) => (index === 50 ? 0.25 : 1)),
        }),
      ),
      synchronized(changedSnapshot(0.75, 1.1, 3)),
      acknowledgeControls,
      message(Message.ClickedSpectrumBand({ name: 'speed', index: 50 })),
      message(frame(1)),
      synchronized(changedSnapshot(0, 1.1, 4)),
      acknowledgeControls,
      message(Message.ClickedSpectrumBand({ name: 'speed', index: 2 })),
      message(
        Message.SelectedControlBand({ name: 'speed', low: 250, high: 4000 }),
      ),
      model(model =>
        expect(model.microphoneBindings).toEqual([
          {
            name: 'speed',
            bands: [2, ...bandsInRange(250, 4000)],
            gain: 1,
            maybeColor: Option.none(),
          },
        ]),
      ),
      message(
        Message.SelectedControlBand({ name: 'speed', low: 250, high: 4000 }),
      ),
      model(model =>
        expect(model.microphoneBindings).toEqual([
          { name: 'speed', bands: [2], gain: 1, maybeColor: Option.none() },
        ]),
      ),
      Command.expectNone(),
    )
  })

  test('dragging paints skipped bands consistently when adding, removing, and backtracking', () => {
    story(
      update,
      given(
        modifyFields(readyModel, {
          maybeSelectedControl: () => Option.some('speed'),
          microphoneBindings: () => [
            { name: 'speed', bands: [50], gain: 1, maybeColor: Option.none() },
          ],
        }),
      ),
      message(Message.StartedSpectrumSelection({ index: -1 })),
      message(
        Message.StartedSpectrumSelection({ index: spectrumBands.length }),
      ),
      message(Message.StartedSpectrumSelection({ index: Number.NaN })),
      model(model => expect(model.spectrumDrag._tag).toBe('Idle')),
      message(Message.StartedSpectrumSelection({ index: 2 })),
      message(Message.MovedSpectrumSelection({ index: 5 })),
      message(Message.MovedSpectrumSelection({ index: 3 })),
      message(Message.MovedSpectrumSelection({ index: 5 })),
      message(Message.MovedSpectrumSelection({ index: 2.5 })),
      message(Message.MovedSpectrumSelection({ index: spectrumBands.length })),
      model(model => {
        expect(model.microphoneBindings[0]?.bands).toHaveLength(5)
        expect(new Set(model.microphoneBindings[0]?.bands)).toEqual(
          new Set([2, 3, 4, 5, 50]),
        )
        expect(model.spectrumDrag).toEqual(
          SpectrumDrag.Dragging({
            name: 'speed',
            lastIndex: 5,
            selection: 'add',
          }),
        )
      }),
      message(Message.EndedSpectrumSelection()),
      message(Message.MovedSpectrumSelection({ index: 10 })),
      message(Message.StartedSpectrumSelection({ index: 4 })),
      message(Message.MovedSpectrumSelection({ index: 1 })),
      message(Message.MovedSpectrumSelection({ index: 3 })),
      message(Message.EndedSpectrumSelection()),
      message(Message.MovedSpectrumSelection({ index: 50 })),
      model(model => {
        expect(model.microphoneBindings[0]?.bands).toHaveLength(2)
        expect(new Set(model.microphoneBindings[0]?.bands)).toEqual(
          new Set([5, 50]),
        )
        expect(model.spectrumDrag._tag).toBe('Idle')
      }),
      Command.expectNone(),
    )
  })

  test('closing the input ends painting and ignores late pointer movement', () => {
    story(
      update,
      given(
        modifyFields(readyModel, {
          maybeSelectedControl: () => Option.some('speed'),
          microphoneBindings: () => [
            { name: 'speed', bands: [], gain: 1, maybeColor: Option.none() },
          ],
        }),
      ),
      message(Message.StartedSpectrumSelection({ index: 2 })),
      message(Message.ClosedControlInput()),
      Command.resolve(FocusControlInput, Message.CompletedFocusControlInput()),
      message(Message.MovedSpectrumSelection({ index: 10 })),
      model(model => {
        expect(model.spectrumDrag._tag).toBe('Idle')
        expect(model.maybeSelectedControl).toStrictEqual(Option.none())
        expect(model.microphoneBindings).toEqual([
          { name: 'speed', bands: [2], gain: 1, maybeColor: Option.none() },
        ])
      }),
      Command.expectNone(),
    )
  })

  test('one frame synchronizes all bound controls once and skips unchanged values', () => {
    const nextSnapshot = changedSnapshot(0.75, 0.65, 2)
    story(
      update,
      given(readyModel),
      message(frame(0.25)),
      synchronized(nextSnapshot),
      acknowledgeControls,
      model(model => {
        expect(model.maybeLive).toStrictEqual(Option.some(nextSnapshot))
        expect(model.spectrum).toEqual(spectrum(0.25))
        expect(model.source).toBe(initialModel.source)
      }),
      message(frame(0.25)),
      Command.expectNone(),
      model(model =>
        expect(model.maybeLive).toStrictEqual(Option.some(nextSnapshot)),
      ),
    )
  })

  test('silence reaches the minimum, sensitivity scales amplitude, and loud input clamps at the maximum', () => {
    story(
      update,
      given(readyModel),
      message(frame(0)),
      synchronized(changedSnapshot(0, 0.2, 2)),
      acknowledgeControls,
      message(Message.UpdatedControlGain({ name: 'speed', gain: 2 })),
      message(frame(0.25)),
      synchronized(changedSnapshot(1.5, 0.65, 3)),
      acknowledgeControls,
      message(Message.UpdatedControlGain({ name: 'intensity', gain: 8 })),
      message(frame(0.75)),
      synchronized(changedSnapshot(3, 2, 4)),
      acknowledgeControls,
    )
  })

  test('bound controls ignore manual edits while ready and allow them after stopping', () => {
    const nextSnapshot = changedSnapshot(2, 1.1, 2)
    story(
      update,
      given(readyModel),
      message(Message.UpdatedControl({ name: 'speed', value: 2 })),
      Command.expectNone(),
      model(model =>
        expect(model.maybeLive).toStrictEqual(Option.some(snapshot)),
      ),
      message(Message.ClickedStopMicrophone()),
      model(model => {
        expect(model.microphone._tag).toBe('Idle')
        expect(model.spectrum).toEqual([])
        expect(subscriptions.microphone.modelToDependencies(model)).toEqual({
          maybeSession: Option.none(),
        })
      }),
      message(frame(1)),
      Command.expectNone(),
      message(Message.UpdatedControl({ name: 'speed', value: 2 })),
      synchronized(nextSnapshot),
      acknowledgeControls,
      message(Message.SelectedControlInput({ name: 'speed', input: 'manual' })),
      model(model =>
        expect(model.microphoneBindings.map(binding => binding.name)).toEqual([
          'intensity',
        ]),
      ),
    )
  })

  test.each([
    { sessionId: 0, spectrum: spectrum(1) },
    { sessionId: 1, spectrum: [] },
    { sessionId: 1, spectrum: spectrum(Number.NaN) },
    { sessionId: 1, spectrum: spectrum(-0.1) },
    { sessionId: 1, spectrum: spectrum(1.1) },
  ])('invalid or stale frames do not change the model: %j', payload => {
    story(
      update,
      given(readyModel),
      message(Message.UpdatedMicrophoneSpectrum(payload)),
      Command.expectNone(),
      model(model => expect(model).toStrictEqual(readyModel)),
    )
  })

  test('restart ignores callbacks from an older microphone session', () => {
    story(
      update,
      given(readyModel),
      message(Message.ClickedStopMicrophone()),
      message(Message.ClickedStartMicrophone()),
      message(Message.SucceededStartMicrophone({ sessionId: 1 })),
      message(
        Message.FailedMicrophone({ sessionId: 1, reason: 'Old stream ended' }),
      ),
      message(frame(1)),
      Command.expectNone(),
      model(model => {
        expect(model.microphone._tag).toBe('Starting')
        expect(model.microphoneSession).toBe(2)
        expect(model.spectrum).toEqual([])
        expect(model.maybeLive).toStrictEqual(Option.some(snapshot))
      }),
      message(Message.SucceededStartMicrophone({ sessionId: 2 })),
      model(model => expect(model.microphone._tag).toBe('Ready')),
    )
  })

  test('compilation keeps the spectrum live without changing shader controls', () => {
    story(
      update,
      given(
        modifyFields(readyModel, {
          render: () => RenderState.Compiling({ draftGeneration: 0 }),
        }),
      ),
      message(frame(0.25)),
      Command.expectNone(),
      model(model => {
        expect(model.spectrum).toEqual(spectrum(0.25))
        expect(model.maybeLive).toStrictEqual(Option.some(snapshot))
      }),
    )
  })

  test('only a successful render prunes bindings and selection for removed controls', () => {
    const source = Option.getOrThrow(
      Array.findFirst(shaderExamples, example => example.id === 'chrome'),
    ).source
    const nextSnapshot = modifyFields(snapshot, {
      source: () => source,
      controls: () => parseControls(source).controls,
      revision: () => 2,
    })
    const diagnostics: ReadonlyArray<Diagnostic> = [
      {
        id: 'validation-error',
        line: 1,
        column: 1,
        severity: 'error',
        message: 'Invalid shader',
      },
    ]
    story(
      update,
      given(
        modifyFields(readyModel, {
          source: () => source,
          maybeSelectedControl: () => Option.some('intensity'),
          spectrumDrag: () =>
            SpectrumDrag.Dragging({
              name: 'intensity',
              lastIndex: 2,
              selection: 'add',
            }),
        }),
      ),
      message(Message.PressedRender()),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({ snapshot: nextSnapshot, diagnostics }),
      ),
      Command.resolve(ShowDiagnostics, Message.CompletedShowDiagnostics()),
      model(model => {
        expect(model.microphoneBindings).toStrictEqual(
          readyModel.microphoneBindings,
        )
        expect(model.maybeSelectedControl).toStrictEqual(
          Option.some('intensity'),
        )
      }),
      message(Message.PressedRender()),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({
          snapshot: nextSnapshot,
          diagnostics: [],
        }),
      ),
      Command.resolveAll(
        [BroadcastState, Message.CompletedBroadcastState()],
        [ShowDiagnostics, Message.CompletedShowDiagnostics()],
      ),
      model(model => {
        expect(model.microphoneBindings).toEqual([
          {
            name: 'speed',
            bands: bandsInRange(20, 250),
            gain: 1,
            maybeColor: Option.none(),
          },
        ])
        expect(model.maybeSelectedControl).toStrictEqual(Option.none())
        expect(model.spectrumDrag._tag).toBe('Idle')
      }),
    )
  })

  test('projection never starts a microphone subscription', () => {
    const projection = modifyFields(readyModel, { mode: () => 'projection' })
    story(
      update,
      given(projection),
      message(Message.ClickedStartMicrophone()),
      message(frame(1)),
      Command.expectNone(),
      model(model => {
        expect(model).toStrictEqual(projection)
        expect(subscriptions.microphone.modelToDependencies(model)).toEqual({
          maybeSession: Option.none(),
        })
      }),
    )
  })
})

test('microphone colors scale the chosen RGB without fading their base, and reset/manual edits refresh it', () => {
  const source = '// @color sky #AABBCC\n// @slider speed 0 3 1 .1'
  const colorSnapshot = modifyFields(snapshot, {
    source: () => source,
    controls: () => parseControls(source).controls,
  })
  const colorModel = modifyFields(readyModel, {
    source: () => source,
    maybeLive: () => Option.some(colorSnapshot),
    microphoneBindings: () => [],
  })
  const bound = update(
    colorModel,
    Message.SelectedControlInput({ name: 'sky', input: 'microphone' }),
  ).model
  const value = (current: typeof bound) =>
    Option.getOrThrow(current.maybeLive).controls[0]?.value
  const half = update(bound, frame(0.5)).model
  expect(value(half)).toBe(0x555e66)
  expect(value(update(half, frame(0.5)).model)).toBe(0x555e66)
  const silent = update(half, frame(0)).model
  expect(value(silent)).toBe(0)
  expect(value(update(silent, frame(1)).model)).toBe(0xaabbcc)
  const sliderEdit = update(
    half,
    Message.UpdatedControl({ name: 'speed', value: 2 }),
  ).model
  expect(value(update(sliderEdit, frame(1)).model)).toBe(0xaabbcc)
  const gain = update(
    half,
    Message.UpdatedControlGain({ name: 'sky', gain: 2 }),
  ).model
  expect(value(update(gain, frame(0.5)).model)).toBe(0xaabbcc)
  const stopped = update(half, Message.ClickedStopMicrophone()).model
  const picked = update(
    stopped,
    Message.UpdatedControl({ name: 'sky', value: 0x224466 }),
  ).model
  const restarted = modifyFields(picked, {
    microphone: () => MicrophoneState.Ready(),
  })
  expect(value(update(restarted, frame(0.5)).model)).toBe(0x112233)
  const reset = update(restarted, Message.ClickedResetControls()).model
  expect(value(update(reset, frame(1)).model)).toBe(0xaabbcc)
  const manual = update(
    half,
    Message.SelectedControlInput({ name: 'sky', input: 'manual' }),
  ).model
  expect(value(update(manual, frame(1)).model)).toBe(0x555e66)
  const rerender = update(
    half,
    Message.CompletedRenderShader({
      snapshot: Option.getOrThrow(half.maybeLive),
      diagnostics: [],
    }),
  ).model
  expect(value(update(rerender, frame(1)).model)).toBe(0xaabbcc)
  const newSource = source.replace('#AABBCC', '#224466')
  const changed = modifyFields(colorSnapshot, {
    source: () => newSource,
    controls: () => parseControls(newSource).controls,
  })
  const rendered = update(
    half,
    Message.CompletedRenderShader({ snapshot: changed, diagnostics: [] }),
  ).model
  expect(value(update(rendered, frame(1)).model)).toBe(0x224466)
})
