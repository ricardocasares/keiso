import { Option } from 'effect'
import {
  Command,
  Mount,
  Subscription,
  change,
  click,
  expect,
  given,
  role,
  scene,
  text,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { test } from 'vitest'

import { Snapshot } from './domain/session'
import { parseControls } from './domain/shader'
import { MountEditor, MountRenderer } from './host'
import {
  BroadcastState,
  FocusControlInput,
  RenderShader,
  ShowDiagnostics,
  SyncControls,
  UpdateEditor,
  init,
  update,
  view,
} from './main'
import { Message } from './message'
import { EngineState } from './model'

const base = init({
  mode: 'control',
  sessionId: 'midi-scene',
  startedAt: 1000,
}).model
const source = '// @slider speed 0 10 4 .1'
const snapshot = Snapshot.make({
  source,
  controls: parseControls(source).controls,
  startedAt: 1000,
  revision: 1,
})
const live = modifyFields(base, {
  source: () => source,
  engine: () => EngineState.Ready(),
  maybeLive: () => Option.some(snapshot),
})
const input = { id: 'keyboard', name: 'Keyboard' }
const cc = {
  inputId: input.id,
  inputName: input.name,
  kind: 'cc',
  channel: 1,
  number: 7,
} satisfies typeof Message.ReceivedMidiSignal.Type.signal.source
const acknowledge = Command.resolveAll(
  [SyncControls, Message.CompletedSyncControls()],
  [BroadcastState, Message.CompletedBroadcastState()],
)

test('MIDI can learn, relearn, cancel, report disconnection, and return to Manual through the input panel', () => {
  scene(
    { update, view },
    given(live),
    Mount.resolve(MountEditor, Message.SucceededMountEditor()),
    Command.resolve(UpdateEditor, Message.CompletedUpdateEditor()),
    Mount.resolve(MountRenderer, Message.SucceededMountRenderer()),
    Command.resolve(
      RenderShader,
      Message.CompletedRenderShader({ snapshot, diagnostics: [] }),
    ),
    Command.resolveAll(
      [BroadcastState, Message.CompletedBroadcastState()],
      [ShowDiagnostics, Message.CompletedShowDiagnostics()],
    ),
    click(role('button', { name: 'Input for speed' })),
    change(role('combobox', { name: 'Input source' }), 'midi'),
    expect(role('combobox', { name: 'Input source' })).toHaveValue('midi'),
    expect(text('Awaiting MIDI permission…')).toExist(),
    expect(role('button', { name: 'Cancel learn' })).toExist(),
    Subscription.emit(Message.SucceededStartMidi({ sessionId: 1, inputs: [] })),
    expect(
      text('No MIDI inputs connected. Plug in a device to continue.'),
    ).toExist(),
    Subscription.emit(
      Message.UpdatedMidiInputs({ sessionId: 1, inputs: [input] }),
    ),
    expect(text('Connected · Keyboard')).toExist(),
    Subscription.emit(
      Message.ReceivedMidiSignal({
        sessionId: 1,
        signal: { source: cc, value: 127 },
      }),
    ),
    acknowledge,
    expect(role('slider', { name: 'speed' })).toHaveValue('10'),
    expect(role('slider', { name: 'speed' })).toBeEnabled(),
    expect(text('Keyboard · Ch 1 · CC 7')).toExist(),
    expect(role('button', { name: 'Relearn MIDI' })).toExist(),
    click(role('button', { name: 'Relearn MIDI' })),
    click(role('button', { name: 'Cancel learn' })),
    expect(text('Keyboard · Ch 1 · CC 7')).toExist(),
    Subscription.emit(Message.UpdatedMidiInputs({ sessionId: 1, inputs: [] })),
    expect(text('Assigned device disconnected · Keyboard')).toExist(),
    Subscription.emit(
      Message.UpdatedMidiInputs({ sessionId: 1, inputs: [input] }),
    ),
    Subscription.emit(
      Message.ReceivedMidiSignal({
        sessionId: 1,
        signal: { source: cc, value: 0 },
      }),
    ),
    acknowledge,
    expect(role('slider', { name: 'speed' })).toHaveValue('0'),
    click(role('button', { name: 'Close input' })),
    Command.resolve(FocusControlInput, Message.CompletedFocusControlInput()),
    click(role('button', { name: 'Input for speed' })),
    expect(role('combobox', { name: 'Input source' })).toHaveValue('midi'),
    change(role('combobox', { name: 'Input source' }), 'manual'),
    expect(role('combobox', { name: 'Input source' })).toHaveValue('manual'),
    expect(role('button', { name: 'Relearn MIDI' })).not.toExist(),
    Command.expectNone(),
  )
})

test('MIDI permission failures expose a retry that starts a fresh learn session', () => {
  scene(
    { update, view },
    given(live),
    Mount.resolve(MountEditor, Message.SucceededMountEditor()),
    Command.resolve(UpdateEditor, Message.CompletedUpdateEditor()),
    Mount.resolve(MountRenderer, Message.SucceededMountRenderer()),
    Command.resolve(
      RenderShader,
      Message.CompletedRenderShader({ snapshot, diagnostics: [] }),
    ),
    Command.resolveAll(
      [BroadcastState, Message.CompletedBroadcastState()],
      [ShowDiagnostics, Message.CompletedShowDiagnostics()],
    ),
    click(role('button', { name: 'Input for speed' })),
    change(role('combobox', { name: 'Input source' }), 'midi'),
    Subscription.emit(
      Message.FailedMidi({ sessionId: 1, reason: 'MIDI access was denied.' }),
    ),
    expect(role('alert')).toExist(),
    expect(text('MIDI access was denied.')).toExist(),
    click(role('button', { name: 'Retry MIDI' })),
    expect(text('Awaiting MIDI permission…')).toExist(),
    Subscription.emit(
      Message.SucceededStartMidi({ sessionId: 2, inputs: [input] }),
    ),
    Subscription.emit(
      Message.ReceivedMidiSignal({
        sessionId: 2,
        signal: { source: cc, value: 127 },
      }),
    ),
    acknowledge,
    expect(text('Keyboard · Ch 1 · CC 7')).toExist(),
    Command.expectNone(),
  )
})
