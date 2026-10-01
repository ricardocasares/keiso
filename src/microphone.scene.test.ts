import { Array } from 'effect'
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

import { spectrumBands } from './audio'
import { Broadcast, Snapshot } from './domain/session'
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
import { MountSpectrumSelection } from './spectrum'

const initialModel = init({
  mode: 'control',
  sessionId: 'microphone-scene',
  startedAt: 1000,
}).model
const snapshot = Snapshot.make({
  source: initialModel.source,
  controls: parseControls(initialModel.source).controls,
  startedAt: initialModel.startedAt,
  revision: 1,
})
const mountEditor = Mount.resolve(MountEditor, Message.SucceededMountEditor())
const updateEditor = Command.resolve(
  UpdateEditor,
  Message.CompletedUpdateEditor(),
)
const mountRenderer = Mount.resolve(
  MountRenderer,
  Message.SucceededMountRenderer(),
)
const renderShader = Command.resolve(
  RenderShader,
  Message.CompletedRenderShader({ snapshot, diagnostics: [] }),
)
const acknowledgeRender = Command.resolveAll(
  [BroadcastState, Message.CompletedBroadcastState()],
  [ShowDiagnostics, Message.CompletedShowDiagnostics()],
)

test('a control can follow a microphone band, stop, and return to manual input', () => {
  const nextSnapshot = modifyFields(snapshot, {
    controls: Array.map(control =>
      control.name === 'speed'
        ? modifyFields(control, { value: () => 1.5 })
        : control,
    ),
    revision: () => 2,
  })
  scene(
    { update, view },
    given(initialModel),
    expect(role('heading', { name: 'Controls' })).toExist(),
    expect(role('heading', { name: 'Parameters' })).toBeAbsent(),
    mountEditor,
    updateEditor,
    mountRenderer,
    renderShader,
    acknowledgeRender,
    click(role('button', { name: 'Input for speed' })),
    expect(role('group', { name: 'Input for speed' })).toExist(),
    expect(role('button', { name: 'Input for speed' })).toHaveAttr(
      'aria-expanded',
      'true',
    ),
    change(role('combobox', { name: 'Input source' }), 'microphone'),
    Mount.expectExact(MountSpectrumSelection),
    Mount.resolve(MountSpectrumSelection, Message.EndedSpectrumSelection()),
    expect(role('button', { name: 'Bass' })).toHaveAttr('aria-pressed', 'true'),
    expect(role('button', { name: '20 Hz–22 Hz' })).toHaveAttr(
      'aria-pressed',
      'true',
    ),
    expect(role('button', { name: '18 kHz–20 kHz' })).toHaveAttr(
      'aria-pressed',
      'false',
    ),
    click(role('button', { name: '18 kHz–20 kHz' })),
    expect(role('button', { name: '20 Hz–22 Hz' })).toHaveAttr(
      'aria-pressed',
      'true',
    ),
    expect(role('button', { name: '18 kHz–20 kHz' })).toHaveAttr(
      'aria-pressed',
      'true',
    ),
    click(role('button', { name: '20 Hz–22 Hz' })),
    expect(role('button', { name: '20 Hz–22 Hz' })).toHaveAttr(
      'aria-pressed',
      'false',
    ),
    expect(role('button', { name: '18 kHz–20 kHz' })).toHaveAttr(
      'aria-pressed',
      'true',
    ),
    expect(role('button', { name: 'Bass' })).toHaveAttr(
      'aria-pressed',
      'false',
    ),
    click(role('button', { name: 'Mids' })),
    expect(role('button', { name: 'Mids' })).toHaveAttr('aria-pressed', 'true'),
    expect(role('button', { name: '20 Hz–22 Hz' })).toHaveAttr(
      'aria-pressed',
      'false',
    ),
    expect(role('button', { name: '18 kHz–20 kHz' })).toHaveAttr(
      'aria-pressed',
      'true',
    ),
    click(role('button', { name: 'Bass' })),
    expect(role('button', { name: 'Bass' })).toHaveAttr('aria-pressed', 'true'),
    expect(role('button', { name: 'Mids' })).toHaveAttr('aria-pressed', 'true'),
    expect(role('button', { name: '20 Hz–22 Hz' })).toHaveAttr(
      'aria-pressed',
      'true',
    ),
    click(role('button', { name: 'Mids' })),
    expect(role('button', { name: 'Mids' })).toHaveAttr(
      'aria-pressed',
      'false',
    ),
    expect(role('button', { name: '20 Hz–22 Hz' })).toHaveAttr(
      'aria-pressed',
      'true',
    ),
    expect(role('button', { name: '18 kHz–20 kHz' })).toHaveAttr(
      'aria-pressed',
      'true',
    ),
    expect(role('slider', { name: 'Low frequency' })).toBeAbsent(),
    expect(role('slider', { name: 'High frequency' })).toBeAbsent(),
    expect(role('slider', { name: 'Microphone gain' })).toHaveValue('1'),
    click(role('button', { name: 'Start mic' })),
    expect(text('Awaiting permission…')).toExist(),
    expect(role('button', { name: 'Cancel microphone' })).toExist(),
    Subscription.emit(Message.SucceededStartMicrophone({ sessionId: 1 })),
    expect(text('● Live')).toExist(),
    expect(role('slider', { name: 'speed' })).toBeDisabled(),
    Subscription.emit(
      Message.UpdatedMicrophoneSpectrum({
        sessionId: 1,
        spectrum: spectrumBands.map(() => 0.5),
      }),
    ),
    Command.expectExact(
      SyncControls({ snapshot: nextSnapshot }),
      BroadcastState({
        broadcast: Broadcast.State({ snapshot: nextSnapshot }),
      }),
    ),
    Command.resolveAll(
      [SyncControls, Message.CompletedSyncControls()],
      [BroadcastState, Message.CompletedBroadcastState()],
    ),
    expect(role('slider', { name: 'speed' })).toHaveValue('1.5'),
    click(role('button', { name: '● Stop microphone' })),
    expect(role('slider', { name: 'speed' })).toBeEnabled(),
    expect(role('button', { name: 'Start mic' })).toExist(),
    change(role('combobox', { name: 'Input source' }), 'manual'),
    Mount.expectEnded(MountSpectrumSelection),
    expect(role('slider', { name: 'Low frequency' })).toBeAbsent(),
    expect(role('button', { name: 'Input for speed' })).toContainText(
      '+ Input',
    ),
    click(role('button', { name: 'Close input' })),
    expect(role('group', { name: 'Input for speed' })).toBeAbsent(),
    Command.expectExact(FocusControlInput({ name: 'speed' })),
    Command.resolve(FocusControlInput, Message.CompletedFocusControlInput()),
    Command.expectNone(),
  )
})

test('permission failure offers retry and a pending request can be cancelled', () => {
  scene(
    { update, view },
    given(initialModel),
    mountEditor,
    updateEditor,
    mountRenderer,
    renderShader,
    acknowledgeRender,
    click(role('button', { name: 'Input for speed' })),
    change(role('combobox', { name: 'Input source' }), 'microphone'),
    Mount.resolve(MountSpectrumSelection, Message.EndedSpectrumSelection()),
    click(role('button', { name: 'Start mic' })),
    Subscription.emit(
      Message.FailedMicrophone({
        sessionId: 1,
        reason: 'Microphone access was denied.',
      }),
    ),
    expect(role('alert')).toContainText('Microphone access was denied.'),
    expect(role('slider', { name: 'speed' })).toBeEnabled(),
    click(role('button', { name: 'Retry mic' })),
    expect(role('alert')).toBeAbsent(),
    click(role('button', { name: 'Cancel microphone' })),
    Subscription.emit(Message.SucceededStartMicrophone({ sessionId: 2 })),
    expect(role('button', { name: 'Start mic' })).toExist(),
    expect(text('● Live')).toBeAbsent(),
    Command.expectNone(),
  )
})
