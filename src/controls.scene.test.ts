import { Array } from 'effect'
import {
  Command,
  Mount,
  Subscription,
  change,
  click,
  expect,
  given,
  label,
  role,
  scene,
  type,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { test } from 'vitest'

import { Broadcast, Snapshot } from './domain/session'
import { parseControls } from './domain/shader'
import { MountEditor, MountRenderer } from './host'
import {
  BroadcastState,
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

test('Slider and color inputs sync live values and Reset restores defaults', () => {
  const baseModel = init({
    mode: 'control',
    sessionId: 'controls-scene',
    startedAt: 1000,
  }).model
  const initialModel = modifyFields(baseModel, {
    source: () => '// @color sky #AABBCC\n// @slider speed 0 3 0.7 0.01',
  })
  const snapshot = Snapshot.make({
    source: initialModel.source,
    controls: parseControls(initialModel.source).controls,
    startedAt: initialModel.startedAt,
    revision: 1,
  })
  const tunedSnapshot = modifyFields(snapshot, {
    controls: Array.map(control =>
      control.name === 'speed'
        ? modifyFields(control, { value: () => 2.4 })
        : control,
    ),
    revision: () => 2,
  })
  const colorSnapshot = modifyFields(tunedSnapshot, {
    controls: Array.map(control =>
      control.name === 'sky'
        ? modifyFields(control, { value: () => 0x123456 })
        : control,
    ),
    revision: () => 3,
  })
  const resetSnapshot = modifyFields(snapshot, { revision: () => 4 })
  const resetButton = role('button', {
    name: 'Reset controls to code defaults',
  })

  scene(
    { update, view },
    given(initialModel),
    expect(resetButton).toBeDisabled(),
    Mount.resolve(MountEditor, Message.SucceededMountEditor()),
    Command.resolve(UpdateEditor, Message.CompletedUpdateEditor()),
    Mount.resolve(MountRenderer, Message.SucceededMountRenderer()),
    expect(resetButton).toBeDisabled(),
    Command.resolve(
      RenderShader,
      Message.CompletedRenderShader({ snapshot, diagnostics: [] }),
    ),
    Command.resolveAll(
      [BroadcastState, Message.CompletedBroadcastState()],
      [ShowDiagnostics, Message.CompletedShowDiagnostics()],
    ),
    expect(resetButton).toBeEnabled(),
    type(role('slider', { name: 'speed' }), '2.4'),
    Command.expectExact(
      SyncControls({ snapshot: tunedSnapshot }),
      BroadcastState({
        broadcast: Broadcast.State({ snapshot: tunedSnapshot }),
      }),
    ),
    Command.resolveAll(
      [SyncControls, Message.CompletedSyncControls()],
      [BroadcastState, Message.CompletedBroadcastState()],
    ),
    expect(role('slider', { name: 'speed' })).toHaveValue('2.4'),
    expect(label('sky')).toHaveValue('#aabbcc'),
    type(label('sky'), '#123456'),
    Command.expectExact(
      SyncControls({ snapshot: colorSnapshot }),
      BroadcastState({
        broadcast: Broadcast.State({ snapshot: colorSnapshot }),
      }),
    ),
    Command.resolveAll(
      [SyncControls, Message.CompletedSyncControls()],
      [BroadcastState, Message.CompletedBroadcastState()],
    ),
    expect(label('sky')).toHaveValue('#123456'),
    Subscription.emit(
      Message.UpdatedSource({
        source: snapshot.source.replace('speed 0 3 0.7', 'speed 0 3 1.2'),
      }),
    ),
    click(resetButton),
    Command.expectExact(
      SyncControls({ snapshot: resetSnapshot }),
      BroadcastState({
        broadcast: Broadcast.State({ snapshot: resetSnapshot }),
      }),
    ),
    Command.resolveAll(
      [SyncControls, Message.CompletedSyncControls()],
      [BroadcastState, Message.CompletedBroadcastState()],
    ),
    expect(role('slider', { name: 'speed' })).toHaveValue('0.7'),
    expect(label('sky')).toHaveValue('#aabbcc'),
    click(role('button', { name: 'Input for sky' })),
    expect(role('group', { name: 'Input for sky' })).toExist(),
    change(role('combobox', { name: 'Input source' }), 'microphone'),
    Mount.resolve(MountSpectrumSelection, Message.EndedSpectrumSelection()),
    expect(role('button', { name: 'Bass' })).toExist(),
    Command.expectNone(),
  )
})
