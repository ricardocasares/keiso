import { Array, Option, Redacted } from 'effect'
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
  label,
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
  FetchAiModels,
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
  init({
    mode: 'control',
    sessionId: 'ai-scene',
    startedAt: 1000,
    maybeSavedPerformance: Option.none(),
  }).model,
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
const apiKey = label('API key (optional)')
const endpoint = label('Endpoint (optional)')
const refreshModels = role('button', { name: 'Refresh models' })
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
    Command.expectExact(
      FetchAiModels({ apiKey: Redacted.make(''), baseUrl: '' }),
    ),
    expect(text('Loading models…')).toExist(),
    expect(modelPicker).toHaveValue('gemma4:31b'),
    expect(modelPicker).toBeDisabled(),
    expect(apiKey).toBeDisabled(),
    expect(endpoint).toBeDisabled(),
    expect(refreshModels).toBeDisabled(),
    expect(send).toBeDisabled(),
    Command.resolve(
      FetchAiModels,
      Message.CompletedFetchAiModels({
        models: ['gemma4:31b', 'qwen3.5:397b'],
      }),
    ),
    change(modelPicker, 'qwen3.5:397b'),
    click(settings),
    expect(configuration).toBeAbsent(),
    expect(modelPicker).toBeAbsent(),
    click(settings),
    expect(modelPicker).toHaveValue('qwen3.5:397b'),
    click(send),
    Command.expectExact(
      GenerateShader({
        prompt: 'I want an aurora floating in the void',
        model: 'qwen3.5:397b',
        apiKey: Redacted.make(''),
        baseUrl: '',
        maybeSource: Option.some(initialModel.source),
      }),
    ),
    expect(prompt).toBeDisabled(),
    expect(includeCode).toBeDisabled(),
    expect(modelPicker).toBeDisabled(),
    expect(apiKey).toBeDisabled(),
    expect(endpoint).toBeDisabled(),
    expect(refreshModels).toBeDisabled(),
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
    expect(prompt).toHaveValue('I want an aurora floating in the void'),
    expect(includeCode).toBeEnabled(),
    expect(modelPicker).toBeEnabled(),
    expect(send).toBeEnabled(),
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
    expect(prompt).toHaveValue('I want an aurora floating in the void'),
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
    expect(prompt).toHaveValue('I want an aurora floating in the void'),
    expect(apply).toBeDisabled(),
    expect(text('Draft is live')).toExist(),
  )
})

test('form submission supports keyboard use and failed previews keep the prompt for retry', () => {
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
        model: 'gemma4:31b',
        apiKey: Redacted.make(''),
        baseUrl: '',
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
      Message.SucceededMountGeneratedPreview({ source }),
    ),
    expect(preview).toExist(),
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
      Message.FailedMountGeneratedPreview({ source, reason: 'Invalid WGSL' }),
    ),
    Mount.expectEnded(MountGeneratedPreview),
    expect(preview).toBeAbsent(),
    expect(role('button', { name: 'Try again' })).toBeDisabled(),
    expect(role('button', { name: 'Try again' })).toHaveText('Try again'),
    hover(role('button', { name: 'Try again' })),
    expect(role('button', { name: 'Try again' })).toHaveAttr(
      'title',
      'Invalid WGSL',
    ),
    expect(prompt).toHaveValue('Aurora'),
    expect(send).toBeEnabled(),
    expect(text('Draft is live')).toExist(),
    Command.expectNone(),
  )
})

test('a failed apply keeps its prompt and exposes the error on the disabled retry button', () => {
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
    type(prompt, 'Aurora'),
    click(send),
    Command.resolve(
      GenerateShader,
      Message.CompletedGenerateShader({ source }),
    ),
    Command.resolve(
      FocusApplyGeneration,
      Message.CompletedFocusApplyGeneration(),
    ),
    click(apply),
    updateEditor,
    expect(apply).toBeDisabled(),
    expect(prompt).toHaveValue('Aurora'),
    Command.resolve(
      RenderShader,
      Message.CompletedRenderShader({
        snapshot: nextSnapshot,
        diagnostics: [
          {
            id: 'compile',
            line: 1,
            column: 1,
            severity: 'error',
            message: 'GPU allocation failed',
          },
        ],
      }),
    ),
    Command.resolve(ShowDiagnostics, Message.CompletedShowDiagnostics()),
    expect(role('button', { name: 'Try again' })).toBeDisabled(),
    hover(role('button', { name: 'Try again' })),
    expect(role('button', { name: 'Try again' })).toHaveAttr(
      'title',
      'GPU allocation failed',
    ),
    expect(prompt).toHaveValue('Aurora'),
    expect(send).toBeEnabled(),
    Command.expectNone(),
  )
})

test('optional connection settings load provider models and are forwarded to generation', () => {
  scene(
    { update, view },
    given(initialModel),
    mountEditor,
    updateEditor,
    mountRenderer,
    renderInitial,
    acknowledgeRender,
    click(settings),
    Command.resolve(
      FetchAiModels,
      Message.CompletedFetchAiModels({ models: ['gemma4:31b'] }),
    ),
    expect(apiKey).toHaveAttr('type', 'password'),
    expect(apiKey).toHaveAttr('autocomplete', 'off'),
    expect(apiKey).toHaveValue(''),
    expect(endpoint).toHaveAttr('type', 'url'),
    expect(endpoint).toHaveAttr('placeholder', 'Server default'),
    expect(endpoint).toHaveValue(''),
    type(apiKey, 'session-api-key'),
    type(endpoint, 'https://llm.example/v1'),
    click(refreshModels),
    Command.expectExact(
      FetchAiModels({
        apiKey: Redacted.make('session-api-key'),
        baseUrl: 'https://llm.example/v1',
      }),
    ),
    Command.resolve(
      FetchAiModels,
      Message.CompletedFetchAiModels({
        models: ['qwen3.5:397b', 'gemma4:31b'],
      }),
    ),
    expect(modelPicker).toHaveValue('gemma4:31b'),
    change(modelPicker, 'qwen3.5:397b'),
    type(prompt, 'Aurora'),
    click(send),
    Command.expectExact(
      GenerateShader({
        prompt: 'Aurora',
        model: 'qwen3.5:397b',
        apiKey: Redacted.make('session-api-key'),
        baseUrl: 'https://llm.example/v1',
        maybeSource: Option.none(),
      }),
    ),
    Command.resolve(
      GenerateShader,
      Message.FailedGenerateShader({
        reason: 'The provider rejected the API key.',
      }),
    ),
    expect(role('alert')).toHaveText('The provider rejected the API key.'),
    expect(role('button', { name: 'Try again' })).toBeDisabled(),
    expect(role('button', { name: 'Try again' })).toHaveAttr(
      'title',
      'The provider rejected the API key.',
    ),
    expect(prompt).toHaveValue('Aurora'),
    expect(apiKey).toBeEnabled(),
    expect(endpoint).toBeEnabled(),
    expect(send).toBeEnabled(),
    type(apiKey, ''),
    type(endpoint, ''),
    click(refreshModels),
    Command.expectExact(
      FetchAiModels({ apiKey: Redacted.make(''), baseUrl: '' }),
    ),
    Command.resolve(
      FetchAiModels,
      Message.CompletedFetchAiModels({ models: ['gemma4:31b'] }),
    ),
    click(send),
    Command.expectExact(
      GenerateShader({
        prompt: 'Aurora',
        model: 'gemma4:31b',
        apiKey: Redacted.make(''),
        baseUrl: '',
        maybeSource: Option.none(),
      }),
    ),
    Command.resolve(
      GenerateShader,
      Message.FailedGenerateShader({ reason: 'Provider unavailable' }),
    ),
  )
})

test('model loading errors can be retried and an empty list retains the default model', () => {
  scene(
    { update, view },
    given(initialModel),
    mountEditor,
    updateEditor,
    mountRenderer,
    renderInitial,
    acknowledgeRender,
    click(settings),
    Command.resolve(
      FetchAiModels,
      Message.FailedFetchAiModels({ reason: 'Provider unavailable' }),
    ),
    expect(role('alert')).toHaveText(
      'Could not load models: Provider unavailable',
    ),
    expect(refreshModels).toBeEnabled(),
    expect(apiKey).toBeEnabled(),
    expect(endpoint).toBeEnabled(),
    click(refreshModels),
    expect(role('alert')).toBeAbsent(),
    expect(text('Loading models…')).toExist(),
    Command.resolve(
      FetchAiModels,
      Message.CompletedFetchAiModels({ models: [] }),
    ),
    expect(
      text('No models returned. You can still use the selected model.'),
    ).toExist(),
    expect(modelPicker).toHaveValue('gemma4:31b'),
    expect(modelPicker).toBeEnabled(),
    type(prompt, 'Aurora'),
    expect(send).toBeEnabled(),
  )
})
