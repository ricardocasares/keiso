import { Array } from 'effect'
import {
  Command,
  Mount,
  Subscription,
  click,
  expect,
  given,
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

test('Reset restores live defaults through the controls toolbar', () => {
  const initialModel = init({
    mode: 'control',
    sessionId: 'controls-scene',
    startedAt: 1000,
  }).model
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
  const resetSnapshot = modifyFields(snapshot, { revision: () => 3 })
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
    Command.expectNone(),
  )
})
