import { Array, Duration, Option, Redacted, Schema } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { HoverIntent } from '@foldkit/ui'

import { Snapshot } from './domain/session'
import { Diagnostic, parseControls } from './domain/shader'
import { shaderExamples } from './examples'
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
} from './main'
import { Message } from './message'
import {
  AiModelsState,
  EngineState,
  GenerationState,
  Model,
  RenderState,
} from './model'

const initialModel = init({
  mode: 'control',
  sessionId: 'ai-story',
  startedAt: 1000,
  maybeSavedPerformance: Option.none(),
}).model
const snapshot = Snapshot.make({
  source: initialModel.source,
  controls: parseControls(initialModel.source).controls,
  startedAt: initialModel.startedAt,
  revision: 1,
})
const liveModel: Model = modifyFields(initialModel, {
  engine: () => EngineState.Ready(),
  aiModels: () =>
    AiModelsState.Ready({
      models: ['gemma4:31b-cloud', 'qwen3.5:cloud', 'gpt-oss:20b'],
    }),
  maybeLive: () => Option.some(snapshot),
})
const source = Option.getOrThrow(
  Array.findFirst(shaderExamples, example => example.id === 'aurora'),
).source
const readyModel: Model = modifyFields(liveModel, {
  generation: () =>
    GenerationState.Ready({ source, preview: EngineState.Starting() }),
})

describe('AI generation', () => {
  test('captures the prompt and selected model without changing the editor or live output until Apply', () => {
    const nextSnapshot = modifyFields(snapshot, {
      source: () => source,
      controls: () => parseControls(source).controls,
      revision: () => 2,
    })
    story(
      update,
      given(liveModel),
      model(current => expect(current.aiModel).toBe('gemma4:31b-cloud')),
      message(Message.SelectedAiModel({ value: 'qwen3.5:cloud' })),
      message(Message.UpdatedAiPrompt({ value: '  An aurora in the void  ' })),
      message(Message.SubmittedAiPrompt()),
      Command.expectExact(
        GenerateShader({
          prompt: 'An aurora in the void',
          model: 'qwen3.5:cloud',
          apiKey: Redacted.make(''),
          baseUrl: '',
          maybeSource: Option.none(),
        }),
      ),
      model(current => {
        expect(current.generation._tag).toBe('Generating')
        expect(current.aiPrompt).toBe('  An aurora in the void  ')
        expect(current.aiModel).toBe('qwen3.5:cloud')
        expect(current.source).toBe(snapshot.source)
        expect(current.maybeLive).toEqual(Option.some(snapshot))
      }),
      Command.resolve(
        GenerateShader,
        Message.CompletedGenerateShader({ source }),
      ),
      Command.expectExact(FocusApplyGeneration()),
      Command.resolve(
        FocusApplyGeneration,
        Message.CompletedFocusApplyGeneration(),
      ),
      Command.expectNone(),
      model(current => {
        expect(current.generation).toEqual(
          GenerationState.Ready({ source, preview: EngineState.Starting() }),
        )
        expect(current.aiPrompt).toBe('  An aurora in the void  ')
        expect(current.source).toBe(snapshot.source)
        expect(current.maybeLive).toEqual(Option.some(snapshot))
      }),
      message(Message.ClickedApplyGeneration()),
      Command.expectExact(
        UpdateEditor({ source, diagnostics: [] }),
        RenderShader({ snapshot: nextSnapshot }),
      ),
      model(current => {
        expect(current.source).toBe(source)
        expect(current.exampleId).toBe('')
        expect(current.draftGeneration).toBe(liveModel.draftGeneration + 1)
        expect(current.generation._tag).toBe('Ready')
        expect(current.aiPrompt).toBe('  An aurora in the void  ')
        expect(current.render._tag).toBe('Compiling')
        expect(current.maybeLive).toEqual(Option.some(snapshot))
      }),
      Command.resolve(UpdateEditor, Message.CompletedUpdateEditor()),
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
      model(current => {
        expect(current.maybeLive).toEqual(Option.some(nextSnapshot))
        expect(current.generation._tag).toBe('Idle')
        expect(current.aiPrompt).toBe('  An aurora in the void  ')
      }),
    )
  })

  test('includes the current editor draft only when enabled', () => {
    const draft = `${snapshot.source}\n// Unsaved draft`
    story(
      update,
      given(liveModel),
      model(current => expect(current.includesEditorCode).toBe(false)),
      message(Message.UpdatedSource({ source: draft })),
      message(Message.ToggledEditorCode({ isIncluded: true })),
      message(Message.UpdatedAiPrompt({ value: 'Make this brighter' })),
      message(Message.SubmittedAiPrompt()),
      Command.expectExact(
        GenerateShader({
          prompt: 'Make this brighter',
          model: 'gemma4:31b-cloud',
          apiKey: Redacted.make(''),
          baseUrl: '',
          maybeSource: Option.some(draft),
        }),
      ),
      model(current => {
        expect(current.includesEditorCode).toBe(true)
        expect(current.source).toBe(draft)
        expect(current.maybeLive).toEqual(Option.some(snapshot))
      }),
      Command.resolve(
        GenerateShader,
        Message.CompletedGenerateShader({ source }),
      ),
      Command.resolve(
        FocusApplyGeneration,
        Message.CompletedFocusApplyGeneration(),
      ),
      message(Message.ToggledEditorCode({ isIncluded: false })),
      message(Message.UpdatedAiPrompt({ value: 'Make this brighter' })),
      message(Message.SubmittedAiPrompt()),
      Command.expectExact(
        GenerateShader({
          prompt: 'Make this brighter',
          model: 'gemma4:31b-cloud',
          apiKey: Redacted.make(''),
          baseUrl: '',
          maybeSource: Option.none(),
        }),
      ),
      Command.resolve(
        GenerateShader,
        Message.CompletedGenerateShader({ source }),
      ),
      Command.resolve(
        FocusApplyGeneration,
        Message.CompletedFocusApplyGeneration(),
      ),
    )
  })

  test('empty prompts, unknown models, unavailable output and stale results cannot apply changes', () => {
    story(
      update,
      given(liveModel),
      message(Message.SelectedAiModel({ value: 'unknown' })),
      message(Message.SubmittedAiPrompt()),
      message(Message.ClickedApplyGeneration()),
      message(Message.CompletedGenerateShader({ source })),
      message(Message.FailedGenerateShader({ reason: 'Stale result' })),
      Command.expectNone(),
      model(current => expect(current).toEqual(liveModel)),
      message(Message.UpdatedAiPrompt({ value: 'A new prompt' })),
      message(Message.CompletedGenerateShader({ source })),
      model(current => expect(current.aiPrompt).toBe('A new prompt')),
      message(Message.UpdatedAiPrompt({ value: ' \n ' })),
      message(Message.SubmittedAiPrompt()),
      Command.expectNone(),
    )
    const generatingModel: Model = modifyFields(liveModel, {
      aiPrompt: () => 'Aurora',
      aiModel: () => 'qwen3.5:cloud',
      generation: () => GenerationState.Generating(),
    })
    story(
      update,
      given(generatingModel),
      message(Message.UpdatedAiPrompt({ value: 'Changed while generating' })),
      message(Message.SelectedAiModel({ value: 'gpt-oss:20b' })),
      message(Message.ToggledEditorCode({ isIncluded: true })),
      message(Message.SubmittedAiPrompt()),
      message(Message.ClickedApplyGeneration()),
      model(current => expect(current).toEqual(generatingModel)),
      Command.expectNone(),
    )
    const blockedModels = [
      modifyFields(readyModel, { mode: () => 'projection' }),
      modifyFields(readyModel, { engine: () => EngineState.Starting() }),
      modifyFields(readyModel, {
        render: () => RenderState.Compiling({ draftGeneration: 0 }),
      }),
    ]
    blockedModels.forEach(blocked => {
      story(
        update,
        given(blocked),
        message(Message.ClickedApplyGeneration()),
        model(current => expect(current).toEqual(blocked)),
        Command.expectNone(),
      )
    })
  })

  test('a failed request retains its prompt and can be retried with the default model', () => {
    story(
      update,
      given(liveModel),
      message(Message.UpdatedAiPrompt({ value: 'Aurora' })),
      message(Message.SubmittedAiPrompt()),
      Command.resolve(
        GenerateShader,
        Message.FailedGenerateShader({ reason: 'Generation unavailable' }),
      ),
      Command.expectNone(),
      model(current => {
        expect(current.generation).toEqual(
          GenerationState.Failed({ reason: 'Generation unavailable' }),
        )
        expect(current.aiPrompt).toBe('Aurora')
        expect(current.maybeLive).toEqual(Option.some(snapshot))
      }),
      message(Message.SubmittedAiPrompt()),
      Command.expectExact(
        GenerateShader({
          prompt: 'Aurora',
          model: 'gemma4:31b-cloud',
          apiKey: Redacted.make(''),
          baseUrl: '',
          maybeSource: Option.none(),
        }),
      ),
      Command.resolve(
        GenerateShader,
        Message.CompletedGenerateShader({ source }),
      ),
      Command.resolve(
        FocusApplyGeneration,
        Message.CompletedFocusApplyGeneration(),
      ),
    )
  })

  test('hover opens with no delay and stale preview results cannot alter the current generation', () => {
    story(
      update,
      given(readyModel),
      message(
        Message.GotAiPreviewMessage({
          message: HoverIntent.Message.EnteredTrigger(),
        }),
      ),
      Command.expectExact(
        HoverIntent.WaitBeforeOpening({ delay: Duration.zero, version: 1 }),
      ),
      Command.resolve(
        HoverIntent.WaitBeforeOpening,
        HoverIntent.Message.CompletedWaitBeforeOpening({ version: 1 }),
      ),
      message(Message.SucceededMountGeneratedPreview({ source })),
      message(
        Message.FailedMountGeneratedPreview({
          source: 'stale',
          reason: 'Old failure',
        }),
      ),
      model(current => {
        expect(current.aiPreview.isOpen).toBe(true)
        expect(current.generation).toEqual(
          GenerationState.Ready({ source, preview: EngineState.Ready() }),
        )
        expect(current.maybeLive).toEqual(Option.some(snapshot))
      }),
      Command.expectNone(),
    )
  })

  test('a preview failure keeps the prompt and live shader and cannot be applied or revived by stale results', () => {
    story(
      update,
      given(modifyFields(readyModel, { aiPrompt: () => 'Aurora' })),
      message(
        Message.FailedMountGeneratedPreview({ source, reason: 'Invalid WGSL' }),
      ),
      message(Message.ClickedApplyGeneration()),
      message(Message.SucceededMountGeneratedPreview({ source })),
      model(current => {
        expect(current.generation).toEqual(
          GenerationState.Failed({ reason: 'Invalid WGSL' }),
        )
        expect(current.aiPrompt).toBe('Aurora')
        expect(current.source).toBe(snapshot.source)
        expect(current.maybeLive).toEqual(Option.some(snapshot))
      }),
      Command.expectNone(),
    )
  })

  test('a failed apply preserves the next prompt and live shader, ignoring a preview failure during compilation', () => {
    const nextSnapshot = modifyFields(snapshot, {
      source: () => source,
      controls: () => parseControls(source).controls,
      revision: () => 2,
    })
    const diagnostics = [
      Diagnostic.make({
        id: 'compile',
        line: 1,
        column: 1,
        severity: 'error',
        message: 'GPU allocation failed',
      }),
    ]
    story(
      update,
      given(modifyFields(readyModel, { aiPrompt: () => 'Aurora' })),
      message(Message.UpdatedAiPrompt({ value: 'My next prompt' })),
      message(Message.ClickedApplyGeneration()),
      model(current => {
        expect(current.generation._tag).toBe('Ready')
        expect(
          update(
            current,
            Message.FailedMountGeneratedPreview({
              source,
              reason: 'Late preview failure',
            }),
          ).model,
        ).toEqual(current)
      }),
      Command.resolve(UpdateEditor, Message.CompletedUpdateEditor()),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({ snapshot: nextSnapshot, diagnostics }),
      ),
      Command.expectExact(ShowDiagnostics({ source, diagnostics })),
      Command.resolve(ShowDiagnostics, Message.CompletedShowDiagnostics()),
      message(Message.ClickedApplyGeneration()),
      model(current => {
        expect(current.generation).toEqual(
          GenerationState.Failed({ reason: 'GPU allocation failed' }),
        )
        expect(current.aiPrompt).toBe('My next prompt')
        expect(current.maybeLive).toEqual(Option.some(snapshot))
      }),
      Command.expectNone(),
    )
  })
})

describe('AI connection settings', () => {
  test('loading models locks connection changes and preserves the cloud default', () => {
    const loadingModel = modifyFields(initialModel, {
      aiModels: () => AiModelsState.Loading(),
    })
    story(
      update,
      given(loadingModel),
      message(Message.UpdatedAiApiKey({ value: Redacted.make('ignored') })),
      message(
        Message.UpdatedAiBaseUrl({ value: 'https://ignored.example/v1' }),
      ),
      message(Message.ClickedRefreshAiModels()),
      model(current => expect(current).toEqual(loadingModel)),
      Command.expectNone(),
    )
    story(
      update,
      given(initialModel),
      message(Message.ToggledAiSettings({ isOpen: true })),
      Command.expectExact(
        FetchAiModels({ apiKey: Redacted.make(''), baseUrl: '' }),
      ),
      model(current => {
        expect(Redacted.value(current.aiApiKey)).toBe('')
        expect(current.aiBaseUrl).toBe('')
        expect(current.aiModels._tag).toBe('Loading')
      }),
      Command.resolve(
        FetchAiModels,
        Message.CompletedFetchAiModels({
          models: ['other-model', 'gemma4:31b'],
        }),
      ),
      model(current => expect(current.aiModel).toBe('gemma4:31b')),
      message(Message.CompletedFetchAiModels({ models: ['stale-model'] })),
      message(Message.FailedFetchAiModels({ reason: 'Stale failure' })),
      model(current => {
        expect(current.aiModel).toBe('gemma4:31b')
        expect(current.aiModels).toEqual(
          AiModelsState.Ready({ models: ['other-model', 'gemma4:31b'] }),
        )
      }),
      Command.expectNone(),
    )
  })

  test('API keys are redacted in messages and omitted from serialized model snapshots', () => {
    const apiKey = Redacted.make('private-provider-key')
    const nextModel = update(
      initialModel,
      Message.UpdatedAiApiKey({ value: apiKey }),
    ).model
    const codec = Schema.toCodecJson(Model)
    const snapshot = Schema.encodeSync(codec)(nextModel)

    expect(Redacted.value(nextModel.aiApiKey)).toBe('private-provider-key')
    expect(
      JSON.stringify(Message.UpdatedAiApiKey({ value: apiKey })),
    ).not.toContain('private-provider-key')
    expect(JSON.stringify(snapshot)).not.toContain('private-provider-key')
    expect(
      Redacted.value(Schema.decodeUnknownSync(codec)(snapshot).aiApiKey),
    ).toBe('')
  })
})
