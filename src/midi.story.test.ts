import { Option, Schema } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { expect, test } from 'vitest'

import { MidiSignal, type MidiSource } from './domain/midi'
import { Broadcast, Snapshot } from './domain/session'
import { parseControls } from './domain/shader'
import {
  BroadcastState,
  FocusControlInput,
  ShowDiagnostics,
  SyncControls,
  init,
  update,
} from './main'
import { Message } from './message'
import { EngineState, MidiState, type Model, RenderState } from './model'
import { subscriptions } from './subscription'

const initial = init({
  mode: 'control',
  sessionId: 'midi-test',
  startedAt: 1000,
}).model
const source = '// @slider speed -2 8 3 .5\n// @color sky #224466'
const snapshot = Snapshot.make({
  source,
  controls: parseControls(source).controls,
  startedAt: 1000,
  revision: 1,
})
const live = modifyFields(initial, {
  source: () => source,
  engine: () => EngineState.Ready(),
  maybeLive: () => Option.some(snapshot),
})
const input = { id: 'device', name: 'Keyboard' }
const cc: MidiSource = {
  inputId: input.id,
  inputName: input.name,
  kind: 'cc',
  channel: 1,
  number: 7,
}
const note: MidiSource = {
  inputId: input.id,
  inputName: input.name,
  kind: 'note',
  channel: 1,
  number: 60,
}
const selected = update(
  live,
  Message.SelectedControlInput({ name: 'speed', input: 'midi' }),
).model
const connected = update(
  selected,
  Message.SucceededStartMidi({ sessionId: 1, inputs: [input] }),
).model
const signal = (source: MidiSource, value: number, sessionId = 1) =>
  Message.ReceivedMidiSignal({ sessionId, signal: { source, value } })
const values = (current: Model) =>
  Option.getOrThrow(current.maybeLive).controls.map(control => control.value)
const acknowledge = Command.resolveAll(
  [SyncControls, Message.CompletedSyncControls()],
  [BroadcastState, Message.CompletedBroadcastState()],
)
const learned = update(connected, signal(cc, 127)).model

test('MIDI selection arms learn, accepts CC zero, snaps values, and syncs the renderer and projection', () => {
  expect(selected.midi._tag).toBe('Starting')
  expect(selected.maybeMidiLearning).toEqual(Option.some('speed'))
  expect(subscriptions.midi.modelToDependencies(selected)).toEqual({
    maybeSession: Option.some(1),
  })
  story(
    update,
    given(connected),
    message(signal(note, 0)),
    model(current => expect(current).toStrictEqual(connected)),
    Command.expectNone(),
    message(signal(cc, 0)),
    model(current => {
      expect(current.midiBindings[0]?.maybeSource).toEqual(Option.some(cc))
      expect(current.maybeMidiLearning).toEqual(Option.none())
      expect(values(current)).toEqual([-2, 0x224466])
    }),
    Command.expectExact(
      SyncControls({
        snapshot: modifyFields(snapshot, {
          controls: controls =>
            controls.map(control =>
              control.name === 'speed'
                ? modifyFields(control, { value: () => -2 })
                : control,
            ),
          revision: () => 2,
        }),
      }),
      BroadcastState({
        broadcast: Broadcast.State({
          snapshot: modifyFields(snapshot, {
            controls: controls =>
              controls.map(control =>
                control.name === 'speed'
                  ? modifyFields(control, { value: () => -2 })
                  : control,
              ),
            revision: () => 2,
          }),
        }),
      }),
    ),
    acknowledge,
    message(signal(cc, 64)),
    acknowledge,
    model(current => expect(values(current)[0]).toBe(3)),
    message(signal(cc, 127)),
    acknowledge,
    model(current => expect(values(current)[0]).toBe(8)),
    message(signal({ ...cc, inputId: 'other' }, 0)),
    message(signal({ ...cc, channel: 2 }, 0)),
    message(signal({ ...cc, number: 8 }, 0)),
    message(signal(note, 127)),
    Command.expectNone(),
    model(current => expect(values(current)[0]).toBe(8)),
  )
})

test('notes use velocity and release; relearn cancellation keeps mappings, and input sources stay exclusive', () => {
  story(
    update,
    given(learned),
    message(Message.ClickedMidiLearn({ name: 'speed' })),
    message(Message.ClickedCancelMidiLearn()),
    model(current =>
      expect(current.midiBindings).toEqual(learned.midiBindings),
    ),
    message(signal(cc, 0)),
    acknowledge,
    message(Message.ClickedMidiLearn({ name: 'speed' })),
    message(signal(note, 127)),
    acknowledge,
    model(current =>
      expect(current.midiBindings[0]?.maybeSource).toEqual(Option.some(note)),
    ),
    message(signal(note, 64)),
    acknowledge,
    model(current => expect(values(current)[0]).toBe(3)),
    message(signal(note, 0)),
    acknowledge,
    model(current => expect(values(current)[0]).toBe(-2)),
    message(
      Message.SelectedControlInput({ name: 'speed', input: 'microphone' }),
    ),
    model(current => {
      expect(current.midiBindings).toEqual([])
      expect(current.microphoneBindings.map(binding => binding.name)).toEqual([
        'speed',
      ])
      expect(current.midi._tag).toBe('Idle')
      expect(subscriptions.midi.modelToDependencies(current)).toEqual({
        maybeSession: Option.none(),
      })
    }),
    message(Message.SelectedControlInput({ name: 'speed', input: 'midi' })),
    model(current => {
      expect(current.microphoneBindings).toEqual([])
      expect(current.midiSession).toBe(2)
    }),
    message(
      Message.SelectedControlInput({ name: 'speed', input: 'oscillator' }),
    ),
    model(current => expect(current.midiBindings).toEqual([])),
    Command.expectNone(),
  )
})

test('MIDI learning survives panel navigation and unrelated source edits', () => {
  story(
    update,
    given(learned),
    message(Message.ClickedControlInput({ name: 'speed' })),
    message(Message.ClickedMidiLearn({ name: 'speed' })),
    message(Message.ClosedControlInput()),
    Command.resolve(FocusControlInput, Message.CompletedFocusControlInput()),
    model(current =>
      expect(current.maybeMidiLearning).toEqual(Option.some('speed')),
    ),
    message(signal(cc, 0)),
    acknowledge,
    message(Message.ClickedMidiLearn({ name: 'speed' })),
    message(Message.ClickedControlInput({ name: 'sky' })),
    model(current =>
      expect(current.maybeMidiLearning).toEqual(Option.some('speed')),
    ),
    message(Message.SelectedControlInput({ name: 'sky', input: 'microphone' })),
    model(current =>
      expect(current.maybeMidiLearning).toEqual(Option.some('speed')),
    ),
    message(Message.SelectedControlInput({ name: 'speed', input: 'manual' })),
    message(Message.UpdatedControl({ name: 'speed', value: 4 })),
    acknowledge,
    message(signal(cc, 127)),
    model(current => expect(values(current)[0]).toBe(4)),
    Command.expectNone(),
  )
})

test('color brightness preserves its base across reset and render, allows manual hue, and removes missing mappings', () => {
  const color = update(
    learned,
    Message.SelectedControlInput({ name: 'sky', input: 'midi' }),
  ).model
  const dimmed = update(color, signal(cc, 64)).model
  expect(values(dimmed)[1]).toBe(0x112233)
  const removedSource = '// @slider speed -2 8 3 .5'
  story(
    update,
    given(dimmed),
    message(
      Message.CompletedRenderShader({
        snapshot: Option.getOrThrow(dimmed.maybeLive),
        diagnostics: [],
      }),
    ),
    Command.resolveAll(
      [BroadcastState, Message.CompletedBroadcastState()],
      [ShowDiagnostics, Message.CompletedShowDiagnostics()],
    ),
    model(current =>
      expect(
        current.midiBindings.find(binding => binding.name === 'sky')
          ?.maybeColor,
      ).toEqual(Option.some(0x224466)),
    ),
    message(signal(cc, 127)),
    acknowledge,
    model(current => expect(values(current)[1]).toBe(0x224466)),
    message(Message.UpdatedControl({ name: 'sky', value: 0x804020 })),
    acknowledge,
    message(signal(cc, 64)),
    acknowledge,
    model(current => expect(values(current)[1]).toBe(0x412010)),
    message(Message.ClickedResetControls()),
    acknowledge,
    message(signal(cc, 0)),
    acknowledge,
    message(signal(cc, 127)),
    acknowledge,
    model(current => expect(values(current)[1]).toBe(0x224466)),
    message(
      Message.CompletedRenderShader({
        snapshot: Snapshot.make({
          source: removedSource,
          controls: parseControls(removedSource).controls,
          startedAt: 1000,
          revision: 20,
        }),
        diagnostics: [],
      }),
    ),
    Command.resolveAll(
      [BroadcastState, Message.CompletedBroadcastState()],
      [ShowDiagnostics, Message.CompletedShowDiagnostics()],
    ),
    model(current =>
      expect(current.midiBindings.map(binding => binding.name)).toEqual([
        'speed',
      ]),
    ),
    Command.expectNone(),
  )
})

test('stale sessions, disconnected devices, invalid signals, compilation, and projection cannot change values', () => {
  const invalidSignals = [
    { source: cc, value: -1 },
    { source: cc, value: 128 },
    { source: cc, value: NaN },
    { source: { ...cc, channel: 17 }, value: 0 },
    { source: { ...cc, number: 128 }, value: 0 },
  ]
  invalidSignals.forEach(payload =>
    expect(Schema.is(MidiSignal)(payload)).toBe(false),
  )
  const inactive = [
    modifyFields(learned, { mode: () => 'projection' }),
    modifyFields(learned, {
      engine: () => EngineState.Failed({ reason: 'lost' }),
    }),
    update(learned, Message.UpdatedMidiInputs({ sessionId: 1, inputs: [] }))
      .model,
  ]
  inactive.forEach(current =>
    expect(update(current, signal(cc, 0)).model).toStrictEqual(current),
  )
  expect(update(learned, signal(cc, 0, 0)).model).toStrictEqual(learned)
  const failed = update(
    learned,
    Message.FailedMidi({ sessionId: 1, reason: 'denied' }),
  ).model
  const retried = update(
    failed,
    Message.ClickedMidiLearn({ name: 'speed' }),
  ).model
  expect(retried.midiSession).toBe(2)
  expect(
    update(
      retried,
      Message.SucceededStartMidi({ sessionId: 1, inputs: [input] }),
    ).model,
  ).toStrictEqual(retried)
  expect(
    update(retried, Message.FailedMidi({ sessionId: 1, reason: 'old' })).model,
  ).toStrictEqual(retried)
  expect(
    update(retried, Message.UpdatedMidiInputs({ sessionId: 1, inputs: [] }))
      .model,
  ).toStrictEqual(retried)
  const reconnected = update(
    learned,
    Message.UpdatedMidiInputs({ sessionId: 1, inputs: [input] }),
  ).model
  expect(values(update(reconnected, signal(cc, 0)).model)[0]).toBe(-2)
  expect(
    update(
      live,
      Message.SelectedControlInput({ name: 'missing', input: 'midi' }),
    ).model,
  ).toStrictEqual(live)
  expect(
    subscriptions.midi.modelToDependencies(
      modifyFields(learned, { mode: () => 'projection' }),
    ),
  ).toEqual({ maybeSession: Option.none() })
  expect(initial.midi).toEqual(MidiState.Idle())
})

test.each([true, false])(
  'note release received during compilation applies after render success=%s',
  succeeds => {
    const held = update(connected, signal(note, 127)).model
    const compiling = modifyFields(held, {
      render: () => RenderState.Compiling({ draftGeneration: 0 }),
    })
    const released = update(compiling, signal(note, 0)).model
    expect(values(released)[0]).toBe(8)
    expect(released.midiBindings[0]?.maybePendingValue).toEqual(Option.some(0))
    const completed = update(
      released,
      Message.CompletedRenderShader({
        snapshot: Option.getOrThrow(held.maybeLive),
        diagnostics: succeeds
          ? []
          : [
              {
                id: 'failed',
                severity: 'error',
                line: 1,
                column: 1,
                message: 'Invalid draft',
              },
            ],
      }),
    )
    expect(values(completed.model)[0]).toBe(-2)
    expect(completed.model.midiBindings[0]?.maybePendingValue).toEqual(
      Option.none(),
    )
    expect(
      completed.commands?.some(command => command.name === 'SyncControls'),
    ).toBe(true)
  },
)

test('removed mappings restart access with a new session, and MIDI uses valid slider step endpoints', () => {
  const onlyColorSource = '// @color sky #224466'
  const next = Snapshot.make({
    source: onlyColorSource,
    controls: parseControls(onlyColorSource).controls,
    startedAt: 1000,
    revision: 10,
  })
  const removed = update(
    learned,
    Message.CompletedRenderShader({ snapshot: next, diagnostics: [] }),
  ).model
  expect(removed.midiBindings).toEqual([])
  expect(removed.midi._tag).toBe('Idle')
  const rebound = update(
    removed,
    Message.SelectedControlInput({ name: 'sky', input: 'midi' }),
  ).model
  expect(rebound.midiSession).toBe(2)
  expect(rebound.midi._tag).toBe('Starting')
  const unevenSource = '// @slider speed 0 1 .6 .3'
  const uneven = modifyFields(connected, {
    maybeLive: () =>
      Option.some(
        Snapshot.make({
          source: unevenSource,
          controls: parseControls(unevenSource).controls,
          startedAt: 1000,
          revision: 1,
        }),
      ),
  })
  expect(values(update(uneven, signal(cc, 127)).model)[0]).toBe(0.9)
})

test('the MIDI button learns, cancels, remaps, and disables a control without opening its input panel', () => {
  const oscillator = update(
    live,
    Message.SelectedControlInput({ name: 'speed', input: 'oscillator' }),
  ).model
  story(
    update,
    given(oscillator),
    message(Message.ClickedControlMidi({ name: 'speed' })),
    model(current => {
      expect(current.maybeSelectedControl).toEqual(Option.none())
      expect(current.maybeMidiLearning).toEqual(Option.some('speed'))
      expect(current.oscillatorBindings).toEqual([])
      expect(current.midi._tag).toBe('Starting')
    }),
    message(Message.ClickedControlMidi({ name: 'speed' })),
    model(current => {
      expect(current.maybeMidiLearning).toEqual(Option.none())
      expect(current.midiBindings).toEqual([])
      expect(current.midi._tag).toBe('Idle')
    }),
    message(Message.ClickedControlMidi({ name: 'speed' })),
    message(Message.SucceededStartMidi({ sessionId: 1, inputs: [input] })),
    model(current => expect(current.midi._tag).toBe('Starting')),
    message(Message.SucceededStartMidi({ sessionId: 2, inputs: [input] })),
    message(signal(cc, 127, 2)),
    acknowledge,
    model(current => {
      expect(current.midiBindings[0]?.maybeSource).toEqual(Option.some(cc))
      expect(current.maybeMidiLearning).toEqual(Option.none())
    }),
    message(Message.ClickedControlMidi({ name: 'speed' })),
    model(current => {
      expect(current.maybeMidiLearning).toEqual(Option.some('speed'))
      expect(current.midiBindings[0]?.maybeSource).toEqual(Option.some(cc))
    }),
    message(signal(note, 64, 2)),
    acknowledge,
    model(current =>
      expect(current.midiBindings[0]?.maybeSource).toEqual(Option.some(note)),
    ),
    message(Message.ClickedControlMidi({ name: 'speed' })),
    message(Message.ClickedControlMidi({ name: 'speed' })),
    model(current => {
      expect(current.maybeMidiLearning).toEqual(Option.none())
      expect(current.midiBindings).toEqual([])
      expect(current.midi._tag).toBe('Idle')
    }),
    message(signal(note, 127, 2)),
    model(current => expect(values(current)[0]).toBe(3)),
    Command.expectNone(),
  )
})

test('moving learn to another button removes only unassigned bindings and a failed connection retries on the next tap', () => {
  const transferred = update(
    selected,
    Message.ClickedControlMidi({ name: 'sky' }),
  ).model
  expect(transferred.midiBindings.map(binding => binding.name)).toEqual(['sky'])
  expect(transferred.maybeMidiLearning).toEqual(Option.some('sky'))
  expect(transferred.midiSession).toBe(1)
  const remapping = update(
    learned,
    Message.ClickedControlMidi({ name: 'speed' }),
  ).model
  const other = update(
    remapping,
    Message.ClickedControlMidi({ name: 'sky' }),
  ).model
  expect(other.midiBindings.map(binding => binding.name)).toEqual([
    'speed',
    'sky',
  ])
  const cancelled = update(
    other,
    Message.ClickedControlMidi({ name: 'sky' }),
  ).model
  expect(cancelled.midiBindings).toEqual(learned.midiBindings)
  expect(cancelled.midi._tag).toBe('Ready')
  const failed = update(
    transferred,
    Message.FailedMidi({ sessionId: 1, reason: 'MIDI access was denied.' }),
  ).model
  expect(failed.maybeMidiLearning).toEqual(Option.none())
  expect(failed.maybeNotice).toEqual(Option.some('MIDI access was denied.'))
  const retried = update(
    failed,
    Message.ClickedControlMidi({ name: 'sky' }),
  ).model
  expect(retried.midi._tag).toBe('Starting')
  expect(retried.midiSession).toBe(2)
  expect(retried.maybeNotice).toEqual(Option.none())
  expect(retried.maybeMidiLearning).toEqual(Option.some('sky'))
  expect(
    update(live, Message.ClickedControlMidi({ name: 'missing' })).model,
  ).toStrictEqual(live)
  const projection = modifyFields(learned, { mode: () => 'projection' })
  expect(
    update(projection, Message.ClickedControlMidi({ name: 'speed' })).model,
  ).toStrictEqual(projection)
})
