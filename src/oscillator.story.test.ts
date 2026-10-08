import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { RadioGroup } from '@foldkit/ui'

import { Broadcast, Snapshot } from './domain/session'
import { parseControls } from './domain/shader'
import {
  BroadcastState,
  ShowDiagnostics,
  SyncControls,
  init,
  update,
} from './main'
import { Message } from './message'
import { EngineState, type Model, RenderState } from './model'
import { subscriptions } from './subscription'

const initialModel = init({
  mode: 'control',
  sessionId: 'oscillator-test',
  startedAt: 1000,
  maybeSavedPerformance: Option.none(),
}).model
const source = `// @slider first 0 10 4 .1
// @slider second 0 10 4 .1
// @color sky #224466`
const snapshot = Snapshot.make({
  source,
  controls: parseControls(source).controls,
  startedAt: initialModel.startedAt,
  revision: 1,
})
const liveModel = modifyFields(initialModel, {
  source: () => source,
  engine: () => EngineState.Ready(),
  maybeLive: () => Option.some(snapshot),
})
const boundModel = update(
  liveModel,
  Message.SelectedControlInput({ name: 'first', input: 'oscillator' }),
).model
const values = (current: Model) =>
  Option.getOrThrow(current.maybeLive).controls.map(control => control.value)
const acknowledgeControls = Command.resolveAll(
  [SyncControls, Message.CompletedSyncControls()],
  [BroadcastState, Message.CompletedBroadcastState()],
)
const acknowledgeRender = Command.resolveAll(
  [BroadcastState, Message.CompletedBroadcastState()],
  [ShowDiagnostics, Message.CompletedShowDiagnostics()],
)
const tick = (seconds: number) =>
  Message.TickedOscillators({ now: initialModel.startedAt + seconds * 1000 })

describe('oscillator inputs', () => {
  test('only live controls can bind, repeated selection preserves settings, and sources are exclusive', () => {
    story(
      update,
      given(liveModel),
      message(
        Message.SelectedControlInput({ name: 'missing', input: 'oscillator' }),
      ),
      model(current => expect(current).toStrictEqual(liveModel)),
      message(
        Message.SelectedControlInput({ name: 'first', input: 'microphone' }),
      ),
      message(
        Message.SelectedControlInput({ name: 'first', input: 'oscillator' }),
      ),
      model(current => {
        expect(current.microphoneBindings).toEqual([])
        expect(current.oscillatorBindings).toEqual([
          {
            name: 'first',
            waveform: 'sine',
            period: 4,
            depth: 100,
            phase: 0,
            maybeColor: Option.none(),
          },
        ])
      }),
      message(
        Message.GotWaveformRadioGroupMessage({
          controlId: 'first',
          message: RadioGroup.Message.SelectedOption({
            index: 1,
            value: 'triangle',
          }),
        }),
      ),
      Command.resolve(
        RadioGroup.FocusOption,
        RadioGroup.Message.CompletedFocusOption(),
      ),
      message(
        Message.UpdatedOscillatorSetting({
          name: 'first',
          setting: 'period',
          value: 2,
        }),
      ),
      message(
        Message.SelectedControlInput({ name: 'first', input: 'oscillator' }),
      ),
      model(current => {
        expect(current.oscillatorBindings[0]?.waveform).toBe('triangle')
        expect(current.oscillatorBindings[0]?.period).toBe(2)
      }),
      message(
        Message.SelectedControlInput({ name: 'first', input: 'microphone' }),
      ),
      model(current => {
        expect(current.oscillatorBindings).toEqual([])
        expect(current.microphoneBindings.map(binding => binding.name)).toEqual(
          ['first'],
        )
      }),
      message(
        Message.SelectedControlInput({ name: 'first', input: 'oscillator' }),
      ),
      message(Message.SelectedControlInput({ name: 'first', input: 'manual' })),
      message(tick(2)),
      model(current => {
        expect(current.oscillatorBindings).toEqual([])
        expect(current.microphoneBindings).toEqual([])
        expect(current.maybeLive).toStrictEqual(Option.some(snapshot))
      }),
      Command.expectNone(),
    )
  })

  test('late attachments share the same clock and phase separates them without changing speed', () => {
    const opposite = modifyFields(snapshot, {
      controls: controls =>
        controls.map(control =>
          control.name === 'first' || control.name === 'second'
            ? modifyFields(control, {
                value: () => (control.name === 'first' ? 10 : 0),
              })
            : control,
        ),
      revision: () => 4,
    })
    story(
      update,
      given(boundModel),
      message(tick(1)),
      acknowledgeControls,
      message(
        Message.SelectedControlInput({ name: 'second', input: 'oscillator' }),
      ),
      message(tick(2)),
      acknowledgeControls,
      model(current => expect(values(current)).toEqual([10, 10, 0x224466])),
      message(
        Message.UpdatedOscillatorSetting({
          name: 'second',
          setting: 'phase',
          value: 180,
        }),
      ),
      message(tick(2)),
      Command.expectExact(
        SyncControls({ snapshot: opposite }),
        BroadcastState({ broadcast: Broadcast.State({ snapshot: opposite }) }),
      ),
      acknowledgeControls,
      model(current => expect(values(current)).toEqual([10, 0, 0x224466])),
      message(tick(2)),
      Command.expectNone(),
      message(tick(4)),
      acknowledgeControls,
      model(current => expect(values(current)).toEqual([0, 10, 0x224466])),
    )
  })

  test('depth centers scalar ranges, dims colors from their base, and zero depth stays steady', () => {
    story(
      update,
      given(boundModel),
      message(
        Message.SelectedControlInput({ name: 'sky', input: 'oscillator' }),
      ),
      message(
        Message.UpdatedOscillatorSetting({
          name: 'first',
          setting: 'depth',
          value: 50,
        }),
      ),
      message(
        Message.UpdatedOscillatorSetting({
          name: 'sky',
          setting: 'depth',
          value: 50,
        }),
      ),
      message(tick(0)),
      acknowledgeControls,
      model(current => expect(values(current)).toEqual([2.5, 4, 0x112233])),
      message(tick(2)),
      acknowledgeControls,
      model(current => expect(values(current)).toEqual([7.5, 4, 0x224466])),
      message(tick(4)),
      acknowledgeControls,
      model(current => expect(values(current)).toEqual([2.5, 4, 0x112233])),
      message(
        Message.UpdatedOscillatorSetting({
          name: 'first',
          setting: 'depth',
          value: 0,
        }),
      ),
      message(
        Message.UpdatedOscillatorSetting({
          name: 'sky',
          setting: 'depth',
          value: 0,
        }),
      ),
      message(tick(4)),
      acknowledgeControls,
      model(current => expect(values(current)).toEqual([5, 4, 0x224466])),
      message(tick(5)),
      Command.expectNone(),
    )
  })

  test('bound controls ignore manual edits and accept them after detaching', () => {
    story(
      update,
      given(boundModel),
      message(Message.UpdatedControl({ name: 'first', value: 7 })),
      model(current => expect(current).toStrictEqual(boundModel)),
      Command.expectNone(),
      message(Message.SelectedControlInput({ name: 'first', input: 'manual' })),
      message(Message.UpdatedControl({ name: 'first', value: 7 })),
      acknowledgeControls,
      message(tick(2)),
      Command.expectNone(),
      model(current => expect(values(current)).toEqual([7, 4, 0x224466])),
    )
  })

  test.each([
    { setting: 'period', value: 0 },
    { setting: 'period', value: 121 },
    { setting: 'depth', value: -1 },
    { setting: 'depth', value: 101 },
    { setting: 'phase', value: -1 },
    { setting: 'phase', value: 361 },
    { setting: 'period', value: Number.NaN },
    { setting: 'depth', value: Number.POSITIVE_INFINITY },
  ] satisfies ReadonlyArray<{
    setting: 'period' | 'depth' | 'phase'
    value: number
  }>)('invalid $setting=$value leaves the model unchanged', payload => {
    story(
      update,
      given(boundModel),
      message(
        Message.UpdatedOscillatorSetting({
          name: 'first',
          setting: payload.setting,
          value: payload.value,
        }),
      ),
      model(current => expect(current).toStrictEqual(boundModel)),
      Command.expectNone(),
    )
  })

  test('invalid ticks, missing bindings, compilation, and projection cannot drive controls', () => {
    story(
      update,
      given(boundModel),
      message(Message.TickedOscillators({ now: Number.NaN })),
      message(Message.TickedOscillators({ now: Number.POSITIVE_INFINITY })),
      message(tick(-1)),
      message(
        Message.UpdatedOscillatorSetting({
          name: 'missing',
          setting: 'period',
          value: 2,
        }),
      ),
      message(
        Message.GotWaveformRadioGroupMessage({
          controlId: 'missing',
          message: RadioGroup.Message.SelectedOption({
            index: 3,
            value: 'square',
          }),
        }),
      ),
      model(current => expect(current).toStrictEqual(boundModel)),
      Command.expectNone(),
    )
    const projection = modifyFields(boundModel, { mode: () => 'projection' })
    const compiling = modifyFields(boundModel, {
      render: () => RenderState.Compiling({ draftGeneration: 0 }),
    })
    expect(subscriptions.oscillators.modelToDependencies(boundModel)).toEqual({
      isActive: true,
    })
    const inactiveModels = [initialModel, liveModel, projection, compiling]
    inactiveModels.forEach(current => {
      expect(subscriptions.oscillators.modelToDependencies(current)).toEqual({
        isActive: false,
      })
      story(
        update,
        given(current),
        message(tick(2)),
        model(next => expect(next).toStrictEqual(current)),
        Command.expectNone(),
      )
    })
    story(
      update,
      given(projection),
      message(
        Message.SelectedControlInput({ name: 'second', input: 'oscillator' }),
      ),
      model(current => expect(current).toStrictEqual(projection)),
      Command.expectNone(),
    )
  })

  test('reset and rerender retain oscillator settings and original color, but changed defaults refresh it', () => {
    const colorModel = update(
      liveModel,
      Message.SelectedControlInput({ name: 'sky', input: 'oscillator' }),
    ).model
    const faded = update(colorModel, tick(1)).model
    const changedSource = source.replace('#224466', '#446688')
    const changed = modifyFields(snapshot, {
      source: () => changedSource,
      controls: () => parseControls(changedSource).controls,
      revision: () => 5,
    })
    const removedSource = '// @slider first 0 10 4 .1'
    const removed = modifyFields(changed, {
      source: () => removedSource,
      controls: () => parseControls(removedSource).controls,
      revision: () => 7,
    })
    story(
      update,
      given(faded),
      message(
        Message.CompletedRenderShader({
          snapshot: Option.getOrThrow(faded.maybeLive),
          diagnostics: [],
        }),
      ),
      acknowledgeRender,
      message(tick(2)),
      acknowledgeControls,
      model(current => expect(values(current)).toEqual([4, 4, 0x224466])),
      message(tick(0)),
      acknowledgeControls,
      message(Message.ClickedResetControls()),
      acknowledgeControls,
      model(current =>
        expect(current.oscillatorBindings).toEqual(
          colorModel.oscillatorBindings,
        ),
      ),
      message(tick(1)),
      acknowledgeControls,
      model(current => expect(values(current)).toEqual([4, 4, 0x112233])),
      message(
        Message.CompletedRenderShader({ snapshot: changed, diagnostics: [] }),
      ),
      acknowledgeRender,
      message(tick(1)),
      acknowledgeControls,
      model(current => expect(values(current)).toEqual([4, 4, 0x223344])),
      message(
        Message.CompletedRenderShader({ snapshot: removed, diagnostics: [] }),
      ),
      acknowledgeRender,
      message(tick(2)),
      Command.expectNone(),
      model(current => expect(current.oscillatorBindings).toEqual([])),
    )
  })
})

test('period drafts survive ticks and invalid input keeps the last valid period', () => {
  story(
    update,
    given(boundModel),
    message(Message.UpdatedOscillatorPeriod({ name: 'first', value: '' })),
    message(tick(1)),
    acknowledgeControls,
    model(current => {
      expect(current.maybeOscillatorPeriodEdit).toEqual(
        Option.some({ name: 'first', value: '' }),
      )
      expect(current.oscillatorBindings[0]?.period).toBe(4)
    }),
    message(Message.UpdatedOscillatorPeriod({ name: 'first', value: '0' })),
    message(Message.UpdatedOscillatorPeriod({ name: 'first', value: '0.5' })),
    model(current => expect(current.oscillatorBindings[0]?.period).toBe(0.5)),
    message(Message.UpdatedOscillatorPeriod({ name: 'first', value: '121' })),
    message(Message.BlurredOscillatorPeriod({ name: 'first' })),
    model(current => {
      expect(current.maybeOscillatorPeriodEdit).toEqual(Option.none())
      expect(current.oscillatorBindings[0]?.period).toBe(0.5)
    }),
    message(Message.UpdatedOscillatorPeriod({ name: 'first', value: 'NaN' })),
    message(Message.SelectedControlInput({ name: 'first', input: 'manual' })),
    model(current =>
      expect(current.maybeOscillatorPeriodEdit).toEqual(Option.none()),
    ),
    Command.expectNone(),
  )
})
