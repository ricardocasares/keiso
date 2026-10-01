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

const initialModel = init({
  mode: 'control',
  sessionId: 'test-session',
  startedAt: 1000,
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
      render: () => RenderState.Compiling(),
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
      render: () => RenderState.Compiling(),
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
