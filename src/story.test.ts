import { Array, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Listbox } from '@foldkit/ui'

import { Broadcast, Snapshot } from './domain/session'
import { type Diagnostic, parseControls } from './domain/shader'
import { shaderExamples } from './examples'
import {
  BroadcastState,
  RenderShader,
  ShowDiagnostics,
  SyncControls,
  UpdateEditor,
  init,
  update,
} from './main'
import { Message } from './message'
import { EngineState, RenderState, Validation } from './model'
import { subscriptions } from './subscription'

const initialModel = init({
  mode: 'control',
  sessionId: 'test-session',
  startedAt: 1000,
  maybeSavedPerformance: Option.none(),
}).model
const liveSnapshot = Snapshot.make({
  source: initialModel.source,
  controls: parseControls(initialModel.source).controls,
  startedAt: initialModel.startedAt,
  revision: 1,
})
const liveModel = modifyFields(initialModel, {
  engine: () => EngineState.Ready(),
  validation: () => Validation.Checked({ diagnostics: [] }),
  maybeLive: () => Option.some(liveSnapshot),
})
const invalidSource = 'fn fragment(uv: vec2f) -> vec4f { return missing; }'
const invalidDiagnostic: Diagnostic = {
  line: 1,
  column: 43,
  id: 'validation-error',
  severity: 'error',
  message: 'Unresolved identifier: missing',
}
const chrome = Option.getOrThrow(
  Array.findFirst(shaderExamples, example => example.id === 'chrome'),
)
const tunnel = Option.getOrThrow(
  Array.findFirst(shaderExamples, example => example.id === 'tunnel'),
)
const plasma = Option.getOrThrow(
  Array.findFirst(shaderExamples, example => example.id === 'plasma'),
)
const nextSnapshot = modifyFields(liveSnapshot, {
  source: () => chrome.source,
  controls: () => parseControls(chrome.source).controls,
  revision: () => 2,
})
const newerSnapshot = modifyFields(nextSnapshot, {
  source: () => tunnel.source,
  controls: () => parseControls(tunnel.source).controls,
  revision: () => 3,
})
const newestSnapshot = modifyFields(nextSnapshot, {
  source: () => plasma.source,
  controls: () => parseControls(plasma.source).controls,
  revision: () => 4,
})

describe('default example input presets', () => {
  const example = shaderExamples[0]
  const acknowledgeRender = Command.resolveAll(
    [BroadcastState, Message.CompletedBroadcastState()],
    [ShowDiagnostics, Message.CompletedShowDiagnostics()],
  )

  test('first render installs inputs without starting the microphone and rerenders retain edits', () => {
    story(
      update,
      given(initialModel),
      message(Message.SucceededMountRenderer()),
      Command.expectExact(RenderShader({ snapshot: liveSnapshot })),
      model(current => {
        expect(current.exampleId).toBe('prismatica')
        expect(current.microphoneBindings).toEqual([])
        expect(current.oscillatorBindings).toEqual([])
      }),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({
          snapshot: liveSnapshot,
          diagnostics: [],
        }),
      ),
      acknowledgeRender,
      model(current => {
        expect(current.microphoneBindings).toEqual(example.microphoneBindings)
        expect(current.oscillatorBindings).toEqual(example.oscillatorBindings)
        expect(subscriptions.oscillators.modelToDependencies(current)).toEqual({
          isActive: true,
        })
        expect(subscriptions.microphone.modelToDependencies(current)).toEqual({
          maybeSession: Option.none(),
        })
      }),
      message(Message.SelectedControlInput({ name: 'bass', input: 'manual' })),
      message(Message.SelectedControlInput({ name: 'hue', input: 'manual' })),
      message(
        Message.UpdatedOscillatorSetting({
          name: 'warp',
          setting: 'period',
          value: 12,
        }),
      ),
      message(Message.PressedRender()),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({
          snapshot: modifyFields(liveSnapshot, { revision: () => 2 }),
          diagnostics: [],
        }),
      ),
      acknowledgeRender,
      model(current => {
        expect(
          current.microphoneBindings.some(binding => binding.name === 'bass'),
        ).toBe(false)
        expect(
          current.oscillatorBindings.some(binding => binding.name === 'hue'),
        ).toBe(false)
        expect(
          current.oscillatorBindings.find(binding => binding.name === 'warp')
            ?.period,
        ).toBe(12)
      }),
    )
  })

  test('switching examples changes inputs only on success and clears conflicting input assignments', () => {
    const previous = modifyFields(liveSnapshot, {
      source: () => `${liveSnapshot.source}\n// Custom inputs`,
    })
    const previousModel = update(
      update(
        modifyFields(liveModel, {
          source: () => previous.source,
          maybeLive: () => Option.some(previous),
        }),
        Message.SelectedControlInput({ name: 'bass', input: 'oscillator' }),
      ).model,
      Message.SelectedControlInput({ name: 'hue', input: 'microphone' }),
    ).model
    const fresh = modifyFields(liveSnapshot, { revision: () => 2 })
    story(
      update,
      given(previousModel),
      message(
        Message.GotExampleListboxMessage({
          message: Listbox.Message.SelectedItem({ item: example.id }),
        }),
      ),
      Command.resolveAll(
        [Listbox.FocusButton, Listbox.Message.CompletedFocusButton()],
        [UpdateEditor, Message.CompletedUpdateEditor()],
      ),
      model(current => {
        expect(current.microphoneBindings).toEqual(
          previousModel.microphoneBindings,
        )
        expect(current.oscillatorBindings).toEqual(
          previousModel.oscillatorBindings,
        )
      }),
      message(Message.PressedRender()),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({
          snapshot: fresh,
          diagnostics: [invalidDiagnostic],
        }),
      ),
      Command.resolve(ShowDiagnostics, Message.CompletedShowDiagnostics()),
      model(current => {
        expect(current.microphoneBindings).toEqual(
          previousModel.microphoneBindings,
        )
        expect(current.oscillatorBindings).toEqual(
          previousModel.oscillatorBindings,
        )
        expect(current.maybeLive).toEqual(Option.some(previous))
      }),
      message(Message.PressedRender()),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({ snapshot: fresh, diagnostics: [] }),
      ),
      acknowledgeRender,
      model(current => {
        expect(current.microphoneBindings).toEqual(example.microphoneBindings)
        expect(current.oscillatorBindings).toEqual(example.oscillatorBindings)
        expect(current.maybeLive).toEqual(Option.some(fresh))
      }),
    )
  })
})

describe('live performance safety', () => {
  test('a rejected render preserves the live snapshot and never broadcasts the draft', () => {
    const draftModel = modifyFields(liveModel, { source: () => invalidSource })
    const rejectedSnapshot = modifyFields(liveSnapshot, {
      source: () => invalidSource,
      controls: () => [],
      revision: () => 2,
    })

    story(
      update,
      given(draftModel),
      message(Message.PressedRender()),
      Command.expectExact(RenderShader({ snapshot: rejectedSnapshot })),
      model(model => {
        expect(model.render._tag).toBe('Compiling')
        expect(model.maybeLive).toStrictEqual(Option.some(liveSnapshot))
      }),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({
          snapshot: rejectedSnapshot,
          diagnostics: [invalidDiagnostic],
        }),
      ),
      Command.expectExact(
        ShowDiagnostics({
          source: invalidSource,
          diagnostics: [invalidDiagnostic],
        }),
      ),
      Command.resolve(ShowDiagnostics, Message.CompletedShowDiagnostics()),
      model(model => {
        expect(model.render._tag).toBe('Idle')
        expect(model.maybeLive).toStrictEqual(Option.some(liveSnapshot))
        expect(model.validation).toStrictEqual(
          Validation.Checked({ diagnostics: [invalidDiagnostic] }),
        )
        expect(Option.getOrThrow(model.maybeNotice)).toContain(
          'last good shader is still live',
        )
      }),
    )
  })

  test('editing keeps output live and ignores stale validation results', () => {
    story(
      update,
      given(liveModel),
      message(Message.UpdatedSource({ source: invalidSource })),
      message(
        Message.CompletedValidateShader({
          source: liveSnapshot.source,
          diagnostics: [],
        }),
      ),
      Command.expectNone(),
      model(model => {
        expect(model.validation._tag).toBe('Checking')
        expect(model.maybeLive).toStrictEqual(Option.some(liveSnapshot))
      }),
      message(
        Message.CompletedValidateShader({
          source: invalidSource,
          diagnostics: [invalidDiagnostic],
        }),
      ),
      Command.expectExact(
        ShowDiagnostics({
          source: invalidSource,
          diagnostics: [invalidDiagnostic],
        }),
      ),
      Command.resolve(ShowDiagnostics, Message.CompletedShowDiagnostics()),
      model(model => {
        expect(model.validation).toStrictEqual(
          Validation.Checked({ diagnostics: [invalidDiagnostic] }),
        )
        expect(model.maybeLive).toStrictEqual(Option.some(liveSnapshot))
      }),
    )
  })

  test('selecting an example loads the editor without rendering or broadcasting it', () => {
    const example = chrome
    story(
      update,
      given(liveModel),
      message(
        Message.GotExampleListboxMessage({
          message: Listbox.Message.Opened({
            maybeActiveItemIndex: Option.none(),
          }),
        }),
      ),
      Command.resolve(
        Listbox.FocusItems,
        Listbox.Message.CompletedFocusItems(),
      ),
      message(
        Message.GotExampleListboxMessage({
          message: Listbox.Message.SelectedItem({ item: example.id }),
        }),
      ),
      Command.expectExact(
        Listbox.FocusButton({ id: 'shader-examples' }),
        UpdateEditor({ source: example.source, diagnostics: [] }),
      ),
      Command.resolve(
        Listbox.FocusButton,
        Listbox.Message.CompletedFocusButton(),
      ),
      Command.resolve(UpdateEditor, Message.CompletedUpdateEditor()),
      model(model => {
        expect(model.source).toBe(example.source)
        expect(model.exampleId).toBe(example.id)
        expect(model.maybeLive).toStrictEqual(Option.some(liveSnapshot))
        expect(model.render._tag).toBe('Idle')
      }),
    )
  })

  test('control edits clamp values and synchronize the same snapshot to preview and projection', () => {
    const snapshot = modifyFields(liveSnapshot, {
      controls: Array.map(control =>
        control.name === 'speed'
          ? modifyFields(control, { value: () => control.max })
          : control,
      ),
      revision: () => 2,
    })
    story(
      update,
      given(liveModel),
      message(Message.UpdatedControl({ name: 'speed', value: Number.NaN })),
      Command.expectNone(),
      message(Message.UpdatedControl({ name: 'speed', value: 100 })),
      Command.expectExact(
        SyncControls({ snapshot }),
        BroadcastState({ broadcast: Broadcast.State({ snapshot }) }),
      ),
      Command.resolveAll(
        [SyncControls, Message.CompletedSyncControls()],
        [BroadcastState, Message.CompletedBroadcastState()],
      ),
      model(model => {
        expect(model.maybeLive).toStrictEqual(Option.some(snapshot))
        expect(model.source).toBe(liveModel.source)
      }),
    )
  })
})

describe('control reconciliation', () => {
  const tunedSnapshot = modifyFields(liveSnapshot, {
    controls: Array.map(control =>
      modifyFields(control, {
        value: () => (control.name === 'speed' ? 2.4 : control.max),
      }),
    ),
  })
  const tunedModel = modifyFields(liveModel, {
    maybeLive: () => Option.some(tunedSnapshot),
  })
  const acknowledgeRender = Command.resolveAll(
    [BroadcastState, Message.CompletedBroadcastState()],
    [ShowDiagnostics, Message.CompletedShowDiagnostics()],
  )
  const selectExample = message(
    Message.GotExampleListboxMessage({
      message: Listbox.Message.SelectedItem({ item: shaderExamples[0].id }),
    }),
  )
  const acknowledgeExample = Command.resolveAll(
    [Listbox.FocusButton, Listbox.Message.CompletedFocusButton()],
    [UpdateEditor, Message.CompletedUpdateEditor()],
  )

  test('source edits keep tuned values and changing one default only resets that control', () => {
    const source = `${liveSnapshot.source}\n// Refined the shader`
    const preserved = modifyFields(tunedSnapshot, {
      source: () => source,
      revision: () => 2,
    })
    const changedDefault = modifyFields(preserved, {
      source: () => source.replace('speed 0 3 0.7', 'speed 0 3 0.5'),
      controls: Array.map(control =>
        control.name === 'speed'
          ? modifyFields(control, { value: () => 0.5 })
          : control,
      ),
      revision: () => 3,
    })
    story(
      update,
      given(tunedModel),
      message(Message.UpdatedSource({ source })),
      message(Message.PressedRender()),
      Command.expectExact(RenderShader({ snapshot: preserved })),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({ snapshot: preserved, diagnostics: [] }),
      ),
      acknowledgeRender,
      message(Message.UpdatedSource({ source: changedDefault.source })),
      message(Message.PressedRender()),
      Command.expectExact(RenderShader({ snapshot: changedDefault })),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({
          snapshot: changedDefault,
          diagnostics: [invalidDiagnostic],
        }),
      ),
      Command.resolve(ShowDiagnostics, Message.CompletedShowDiagnostics()),
      model(model =>
        expect(model.maybeLive).toStrictEqual(Option.some(preserved)),
      ),
      message(Message.PressedRender()),
      Command.expectExact(RenderShader({ snapshot: changedDefault })),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({
          snapshot: changedDefault,
          diagnostics: [],
        }),
      ),
      acknowledgeRender,
      model(model =>
        expect(model.maybeLive).toStrictEqual(Option.some(changedDefault)),
      ),
    )
  })

  test('example reload resets after success, survives a failed render, and preserves later tuning', () => {
    const resetSnapshot = modifyFields(liveSnapshot, { revision: () => 2 })
    const nextDraft = `${liveSnapshot.source}\n// Continuing to edit`
    const editedSnapshot = modifyFields(resetSnapshot, {
      source: () => nextDraft,
      controls: Array.map(control =>
        control.name === 'speed'
          ? modifyFields(control, { value: () => 2.4 })
          : control,
      ),
      revision: () => 4,
    })
    story(
      update,
      given(tunedModel),
      selectExample,
      acknowledgeExample,
      model(model =>
        expect(model.maybeLive).toStrictEqual(Option.some(tunedSnapshot)),
      ),
      message(Message.PressedRender()),
      Command.expectExact(RenderShader({ snapshot: resetSnapshot })),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({
          snapshot: resetSnapshot,
          diagnostics: [invalidDiagnostic],
        }),
      ),
      Command.resolve(ShowDiagnostics, Message.CompletedShowDiagnostics()),
      message(Message.PressedRender()),
      Command.expectExact(RenderShader({ snapshot: resetSnapshot })),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({
          snapshot: resetSnapshot,
          diagnostics: [],
        }),
      ),
      acknowledgeRender,
      message(Message.UpdatedSource({ source: nextDraft })),
      message(Message.UpdatedControl({ name: 'speed', value: 2.4 })),
      Command.resolveAll(
        [SyncControls, Message.CompletedSyncControls()],
        [BroadcastState, Message.CompletedBroadcastState()],
      ),
      message(Message.PressedRender()),
      Command.expectExact(RenderShader({ snapshot: editedSnapshot })),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({
          snapshot: editedSnapshot,
          diagnostics: [],
        }),
      ),
      acknowledgeRender,
    )
  })

  test('an example selected during compilation still starts fresh on the next render', () => {
    const pendingSnapshot = modifyFields(tunedSnapshot, {
      source: () => `${liveSnapshot.source}\n// Edit before loading an example`,
      revision: () => 2,
    })
    const resetSnapshot = modifyFields(liveSnapshot, { revision: () => 3 })
    const pendingRender = update(
      update(
        tunedModel,
        Message.UpdatedSource({ source: pendingSnapshot.source }),
      ).model,
      Message.PressedRender(),
    )
    story(
      update,
      given(pendingRender.model),
      selectExample,
      acknowledgeExample,
      message(
        Message.CompletedRenderShader({
          snapshot: pendingSnapshot,
          diagnostics: [],
        }),
      ),
      acknowledgeRender,
      message(Message.PressedRender()),
      Command.expectExact(RenderShader({ snapshot: resetSnapshot })),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({
          snapshot: resetSnapshot,
          diagnostics: [],
        }),
      ),
      acknowledgeRender,
    )
  })
})

describe('projection synchronization', () => {
  test('GPU acquisition failure is reported again when the channel becomes ready', () => {
    const reason = 'No WebGPU adapter is available.'
    const broadcast = Broadcast.Status({
      reason: `Projection unavailable: ${reason}`,
    })
    story(
      update,
      given(modifyFields(initialModel, { mode: () => 'projection' })),
      message(Message.FailedMountRenderer({ reason })),
      Command.expectExact(BroadcastState({ broadcast })),
      Command.resolve(
        BroadcastState,
        Message.FailedBroadcastState({
          reason: 'BroadcastChannel is not ready.',
        }),
      ),
      message(Message.SucceededMountChannel()),
      Command.expectExact(BroadcastState({ broadcast })),
      Command.resolve(BroadcastState, Message.CompletedBroadcastState()),
      model(model => {
        expect(model.engine).toStrictEqual(EngineState.Failed({ reason }))
        expect(model.maybeLive).toStrictEqual(Option.none())
      }),
    )
  })

  test('a new projection receives the current live state through its handshake', () => {
    story(
      update,
      given(liveModel),
      message(Message.ReceivedBroadcast({ broadcast: Broadcast.Hello() })),
      Command.expectExact(
        BroadcastState({
          broadcast: Broadcast.State({ snapshot: liveSnapshot }),
        }),
      ),
      Command.resolve(BroadcastState, Message.CompletedBroadcastState()),
      model(model => expect(model).toStrictEqual(liveModel)),
    )
  })

  test('a snapshot arriving before GPU readiness waits and then renders', () => {
    const projectionModel = modifyFields(initialModel, {
      mode: () => 'projection',
    })
    story(
      update,
      given(projectionModel),
      message(
        Message.ReceivedBroadcast({
          broadcast: Broadcast.State({ snapshot: nextSnapshot }),
        }),
      ),
      Command.expectNone(),
      model(model =>
        expect(model.maybeIncoming).toStrictEqual(Option.some(nextSnapshot)),
      ),
      message(Message.SucceededMountRenderer()),
      Command.expectExact(RenderShader({ snapshot: nextSnapshot })),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({
          snapshot: nextSnapshot,
          diagnostics: [],
        }),
      ),
      Command.expectExact(
        BroadcastState({
          broadcast: Broadcast.Status({ reason: 'Projection is live' }),
        }),
      ),
      Command.resolve(BroadcastState, Message.CompletedBroadcastState()),
      model(model =>
        expect(model.maybeLive).toStrictEqual(Option.some(nextSnapshot)),
      ),
    )
  })

  test('while compiling, projection keeps the newest revision even if an older one arrives later', () => {
    const projectionModel = modifyFields(liveModel, {
      mode: () => 'projection',
      render: () => RenderState.Compiling({ draftGeneration: 0 }),
      maybeIncoming: () => Option.some(nextSnapshot),
    })
    story(
      update,
      given(projectionModel),
      message(
        Message.ReceivedBroadcast({
          broadcast: Broadcast.State({ snapshot: newestSnapshot }),
        }),
      ),
      message(
        Message.ReceivedBroadcast({
          broadcast: Broadcast.State({ snapshot: newerSnapshot }),
        }),
      ),
      Command.expectNone(),
      model(model =>
        expect(model.maybeIncoming).toStrictEqual(Option.some(newestSnapshot)),
      ),
      message(
        Message.CompletedRenderShader({
          snapshot: nextSnapshot,
          diagnostics: [],
        }),
      ),
      Command.expectExact(RenderShader({ snapshot: newestSnapshot })),
      Command.resolve(
        RenderShader,
        Message.CompletedRenderShader({
          snapshot: newestSnapshot,
          diagnostics: [],
        }),
      ),
      Command.resolve(BroadcastState, Message.CompletedBroadcastState()),
      model(model =>
        expect(model.maybeLive).toStrictEqual(Option.some(newestSnapshot)),
      ),
    )
  })

  test('a failed projection compilation still drains a newer queued snapshot', () => {
    const projectionModel = modifyFields(liveModel, {
      mode: () => 'projection',
      render: () => RenderState.Compiling({ draftGeneration: 0 }),
      maybeIncoming: () => Option.some(newestSnapshot),
    })
    story(
      update,
      given(projectionModel),
      message(
        Message.CompletedRenderShader({
          snapshot: nextSnapshot,
          diagnostics: [invalidDiagnostic],
        }),
      ),
      Command.expectHas(RenderShader({ snapshot: newestSnapshot })),
      Command.resolveAll(
        [BroadcastState, Message.CompletedBroadcastState()],
        [
          RenderShader,
          Message.CompletedRenderShader({
            snapshot: newestSnapshot,
            diagnostics: [],
          }),
        ],
      ),
      model(model =>
        expect(model.maybeLive).toStrictEqual(Option.some(newestSnapshot)),
      ),
    )
  })
})
