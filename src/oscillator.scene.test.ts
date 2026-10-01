import {
  Command,
  Mount,
  Subscription,
  blur,
  change,
  click,
  expect,
  given,
  keydown,
  role,
  scene,
  text,
  type,
} from 'foldkit/scene'
import { test } from 'vitest'

import { RadioGroup } from '@foldkit/ui'

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

test('a control can configure an oscillator and return to manual input', () => {
  const initialModel = init({
    mode: 'control',
    sessionId: 'oscillator-scene',
    startedAt: 1000,
  }).model
  const snapshot = Snapshot.make({
    source: initialModel.source,
    controls: parseControls(initialModel.source).controls,
    startedAt: initialModel.startedAt,
    revision: 1,
  })
  const source = role('combobox', { name: 'Input source' })
  const waveform = role('radiogroup', { name: 'Oscillator waveform' })
  const period = role('spinbutton', { name: 'Oscillator period' })
  const depth = role('slider', { name: 'Oscillator depth' })
  const phase = role('slider', { name: 'Oscillator phase' })
  const slider = role('slider', { name: 'speed' })
  const inputButton = role('button', { name: 'Input for speed' })
  const focusWaveform = Command.resolve(
    RadioGroup.FocusOption,
    RadioGroup.Message.CompletedFocusOption(),
  )
  const acknowledgeControls = Command.resolveAll(
    [SyncControls, Message.CompletedSyncControls()],
    [BroadcastState, Message.CompletedBroadcastState()],
  )

  scene(
    { update, view },
    given(initialModel),
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
    expect(slider).toBeEnabled(),
    click(inputButton),
    change(source, 'oscillator'),
    Mount.expectNone(),
    expect(source).toHaveValue('oscillator'),
    expect(slider).toBeDisabled(),
    expect(role('button', { name: 'Start mic' })).toBeAbsent(),
    expect(waveform).toExist(),
    expect(role('radio', { name: 'sine' })).toHaveAttr('aria-checked', 'true'),
    expect(role('radio', { name: 'square' })).toExist(),
    expect(period).toHaveValue('4'),
    expect(depth).toHaveValue('100'),
    expect(phase).toHaveValue('0'),
    type(period, ''),
    Subscription.emit(
      Message.TickedOscillators({ now: initialModel.startedAt + 1000 }),
    ),
    acknowledgeControls,
    expect(period).toHaveValue(''),
    expect(inputButton).toContainText('Osc · sine · 4s · 0°'),
    blur(period),
    expect(period).toHaveValue('4'),
    type(period, '0'),
    Subscription.emit(
      Message.TickedOscillators({ now: initialModel.startedAt + 2000 }),
    ),
    acknowledgeControls,
    expect(period).toHaveValue('0'),
    expect(inputButton).toContainText('Osc · sine · 4s · 0°'),
    blur(period),
    expect(period).toHaveValue('4'),
    click(role('radio', { name: 'triangle' })),
    focusWaveform,
    expect(role('radio', { name: 'triangle' })).toHaveAttr(
      'aria-checked',
      'true',
    ),
    keydown(role('radio', { name: 'triangle' }), 'ArrowRight'),
    focusWaveform,
    expect(role('radio', { name: 'sawtooth' })).toHaveAttr(
      'aria-checked',
      'true',
    ),
    keydown(role('radio', { name: 'sawtooth' }), 'ArrowLeft'),
    focusWaveform,
    type(period, '2.5'),
    type(depth, '40'),
    type(phase, '180'),
    click(role('button', { name: 'Close input' })),
    Command.resolve(FocusControlInput, Message.CompletedFocusControlInput()),
    click(inputButton),
    expect(role('radio', { name: 'triangle' })).toHaveAttr(
      'aria-checked',
      'true',
    ),
    expect(period).toHaveValue('2.5'),
    expect(depth).toHaveValue('40'),
    expect(phase).toHaveValue('180'),
    expect(text('Depth · 40%')).toExist(),
    expect(text('Phase · 180°')).toExist(),
    expect(inputButton).toContainText('Osc · triangle · 2.5s · 180°'),
    change(source, 'manual'),
    expect(source).toHaveValue('manual'),
    expect(slider).toBeEnabled(),
    expect(waveform).toBeAbsent(),
    expect(period).toBeAbsent(),
    expect(depth).toBeAbsent(),
    expect(phase).toBeAbsent(),
    expect(inputButton).toContainText('+ Input'),
    Mount.expectNone(),
    Command.expectNone(),
  )
})
