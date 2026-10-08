import { Array, Duration, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { HoverIntent } from '@foldkit/ui'

import { Snapshot } from './domain/session'
import { parseControls } from './domain/shader'
import { shaderExamples } from './examples'
import {
  BroadcastState,
  FocusApplyGeneration,
  GenerateShader,
  RenderShader,
  ShowDiagnostics,
  UpdateEditor,
  init,
  update,
} from './main'
import { Message } from './message'
import { EngineState, GenerationState, type Model, RenderState } from './model'

const initialModel = init({
  mode: 'control',
  sessionId: 'ai-story',
  startedAt: 1000,
}).model
const snapshot = Snapshot.make({
  source: initialModel.source,
  controls: parseControls(initialModel.source).controls,
  startedAt: initialModel.startedAt,
  revision: 1,
})
const liveModel: Model = modifyFields(initialModel, {
  engine: () => EngineState.Ready(),
  maybeLive: () => Option.some(snapshot),
})
const source = Option.getOrThrow(
  Array.findFirst(shaderExamples, example => example.id === 'aurora'),
).source
const readyModel: Model = modifyFields(liveModel, {
  generation: () =>
    GenerationState.Ready({ source, preview: EngineState.Starting() }),
})

describe('mock AI generation', () => {
  test('captures the prompt and selected model without changing the editor or live output until Apply', () => {
    const nextSnapshot = modifyFields(snapshot, {
      source: () => source,
      controls: () => parseControls(source).controls,
      revision: () => 2,
    })
    story(
      update,
      given(liveModel),
      model(current => expect(current.aiModel).toBe('GPT')),
      message(Message.SelectedAiModel({ value: 'Claude' })),
      message(Message.UpdatedAiPrompt({ value: '  An aurora in the void  ' })),
      message(Message.SubmittedAiPrompt()),
      Command.expectExact(
        GenerateShader({
          prompt: 'An aurora in the void',
          model: 'Claude',
          maybeSource: Option.none(),
        }),
      ),
      model(current => {
        expect(current.generation._tag).toBe('Generating')
        expect(current.aiPrompt).toBe('  An aurora in the void  ')
        expect(current.aiModel).toBe('Claude')
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
        expect(current.aiPrompt).toBe('')
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
        expect(current.generation._tag).toBe('Idle')
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
      model(current =>
        expect(current.maybeLive).toEqual(Option.some(nextSnapshot)),
      ),
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
          model: 'GPT',
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
          model: 'GPT',
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
      aiModel: () => 'Claude',
      generation: () => GenerationState.Generating(),
    })
    story(
      update,
      given(generatingModel),
      message(Message.UpdatedAiPrompt({ value: 'Changed while generating' })),
      message(Message.SelectedAiModel({ value: 'Gemini' })),
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
          model: 'GPT',
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
})
