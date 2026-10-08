import { Array, Option } from 'effect'
import {
  Command,
  Mount,
  blur,
  change,
  click,
  expect,
  focus,
  given,
  hover,
  keydown,
  role,
  scene,
  selector,
  submit,
  text,
  type,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { test } from 'vitest'

import { HoverIntent } from '@foldkit/ui'

import { MountGeneratedPreview } from './ai-preview'
import { Snapshot } from './domain/session'
import { parseControls } from './domain/shader'
import { shaderExamples } from './examples'
import { MountEditor, MountRenderer } from './host'
import {
  BroadcastState,
  FocusApplyGeneration,
  GenerateShader,
  RenderShader,
  ShowDiagnostics,
  UpdateEditor,
  init,
  update,
  view,
} from './main'
import { Message } from './message'

const initialModel = modifyFields(
  init({ mode: 'control', sessionId: 'ai-scene', startedAt: 1000 }).model,
  { source: source => `${source}\n// Custom draft`, exampleId: () => '' },
)
const snapshot = Snapshot.make({
  source: initialModel.source,
  controls: parseControls(initialModel.source).controls,
  startedAt: initialModel.startedAt,
  revision: 1,
})
const source = Option.getOrThrow(
  Array.findFirst(shaderExamples, example => example.id === 'aurora'),
).source
const prompt = role('textbox', { name: 'Ask AI' })
const modelPicker = role('combobox', { name: 'AI model' })
const includeCode = role('button', { name: 'Include current code' })
const settings = role('button', { name: 'AI settings' })
const configuration = role('region', { name: 'AI configuration' })
const send = role('button', { name: 'Send prompt' })
const apply = role('button', { name: 'Apply generated visualization' })
const preview = role('region', { name: 'Generated visualization preview' })
const mountEditor = Mount.resolve(MountEditor, Message.SucceededMountEditor())
const updateEditor = Command.resolve(
  UpdateEditor,
  Message.CompletedUpdateEditor(),
)
const mountRenderer = Mount.resolve(
  MountRenderer,
  Message.SucceededMountRenderer(),
)
const renderInitial = Command.resolve(
  RenderShader,
  Message.CompletedRenderShader({ snapshot, diagnostics: [] }),
)
const acknowledgeRender = Command.resolveAll(
  [BroadcastState, Message.CompletedBroadcastState()],
  [ShowDiagnostics, Message.CompletedShowDiagnostics()],
)

test('compact AI controls disable during generation, preview on hover, and apply through the renderer', () => {
  const nextSnapshot = modifyFields(snapshot, {
    source: () => source,
    controls: () => parseControls(source).controls,
    revision: () => 2,
  })
  scene(
    { update, view },
    given(initialModel),
    mountEditor,
    updateEditor,
    mountRenderer,
    renderInitial,
    acknowledgeRender,
    expect(prompt).toHaveAttr('placeholder', 'Ask AI'),
    expect(modelPicker).toBeAbsent(),
    expect(configuration).toBeAbsent(),
    expect(includeCode).toHaveAttr('aria-pressed', 'false'),
    expect(send).toBeDisabled(),
    expect(apply).toBeDisabled(),
    type(prompt, 'I want an aurora floating in the void'),
    click(includeCode),
    expect(includeCode).toHaveAttr('aria-pressed', 'true'),
    click(settings),
    expect(configuration).toExist(),
    expect(settings).toHaveAttr('aria-expanded', 'true'),
    expect(modelPicker).toHaveValue('GPT'),
    change(modelPicker, 'Gemini'),
    click(settings),
    expect(configuration).toBeAbsent(),
    expect(modelPicker).toBeAbsent(),
    click(settings),
    expect(modelPicker).toHaveValue('Gemini'),
    click(send),
    Command.expectExact(
      GenerateShader({
        prompt: 'I want an aurora floating in the void',
        model: 'Gemini',
        maybeSource: Option.some(initialModel.source),
      }),
    ),
    expect(prompt).toBeDisabled(),
    expect(includeCode).toBeDisabled(),
    expect(modelPicker).toBeDisabled(),
    expect(send).toBeDisabled(),
    expect(role('button', { name: 'Generating' })).toBeDisabled(),
    expect(text('Draft is live')).toExist(),
    Command.resolve(
      GenerateShader,
      Message.CompletedGenerateShader({ source }),
    ),
    Command.resolve(
      FocusApplyGeneration,
      Message.CompletedFocusApplyGeneration(),
    ),
    expect(prompt).toBeEnabled(),
    expect(prompt).toHaveValue(''),
    expect(includeCode).toBeEnabled(),
    expect(modelPicker).toBeEnabled(),
    expect(send).toBeDisabled(),
    expect(apply).toBeEnabled(),
    keydown(configuration, 'Escape'),
    expect(configuration).toBeAbsent(),
    expect(settings).toHaveAttr('aria-expanded', 'false'),
    expect(preview).toBeAbsent(),
    hover(apply),
    Command.resolve(
      HoverIntent.WaitBeforeOpening,
      HoverIntent.Message.CompletedWaitBeforeOpening({ version: 1 }),
    ),
    Mount.expectExact(
      MountGeneratedPreview({ source, startedAt: initialModel.startedAt }),
    ),
    Mount.resolve(
      MountGeneratedPreview,
      Message.SucceededMountGeneratedPreview({ source }),
    ),
    expect(preview).toExist(),
    expect(selector('canvas[aria-label="Generated WGSL preview"]')).toExist(),
    expect(apply).toHaveAttr('aria-expanded', 'true'),
    expect(text('Draft is live')).toExist(),
    click(apply),
    Mount.expectEnded(MountGeneratedPreview),
    expect(preview).toBeAbsent(),
    expect(apply).toBeDisabled(),
    Command.expectExact(
      UpdateEditor({ source, diagnostics: [] }),
      RenderShader({ snapshot: nextSnapshot }),
    ),
    updateEditor,
    Command.resolve(
      RenderShader,
      Message.CompletedRenderShader({
        snapshot: nextSnapshot,
        diagnostics: [],
      }),
    ),
    acknowledgeRender,
    expect(text('Draft is live')).toExist(),
  )
})

test('form submission supports keyboard use and focus previews close on Escape, including GPU failure', () => {
  scene(
    { update, view },
    given(initialModel),
    mountEditor,
    updateEditor,
    mountRenderer,
    renderInitial,
    acknowledgeRender,
    type(prompt, 'Aurora'),
    submit(role('form', { name: 'Generate visualization' })),
    Command.expectExact(
      GenerateShader({
        prompt: 'Aurora',
        model: 'GPT',
        maybeSource: Option.none(),
      }),
    ),
    Command.resolve(
      GenerateShader,
      Message.CompletedGenerateShader({ source }),
    ),
    Command.expectExact(FocusApplyGeneration()),
    Command.resolve(
      FocusApplyGeneration,
      Message.CompletedFocusApplyGeneration(),
    ),
    focus(apply),
    Command.expectNone(),
    Mount.resolve(
      MountGeneratedPreview,
      Message.FailedMountGeneratedPreview({
        source,
        reason: 'Preview GPU unavailable',
      }),
    ),
    expect(preview).toExist(),
    expect(text('Preview unavailable')).toExist(),
    expect(text('Preview GPU unavailable')).toExist(),
    expect(apply).toBeEnabled(),
    expect(text('Draft is live')).toExist(),
    keydown(apply, 'Escape'),
    Mount.expectEnded(MountGeneratedPreview),
    expect(preview).toBeAbsent(),
    expect(apply).toHaveAttr('aria-expanded', 'false'),
    blur(apply),
    focus(apply),
    Mount.resolve(
      MountGeneratedPreview,
      Message.SucceededMountGeneratedPreview({ source }),
    ),
    expect(preview).toExist(),
    expect(text('Preview unavailable')).toBeAbsent(),
    keydown(apply, 'Escape'),
    Mount.expectEnded(MountGeneratedPreview),
    expect(preview).toBeAbsent(),
    Command.expectNone(),
  )
})
