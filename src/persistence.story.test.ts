import { Effect, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { afterEach, expect, test } from 'vitest'

import { Broadcast, Snapshot } from './domain/session'
import { parseControls } from './domain/shader'
import { shaderExamples } from './examples'
import {
  BroadcastState,
  RenderShader,
  ShowDiagnostics,
  flags,
  init,
  update,
} from './main'
import { Message } from './message'
import { EngineState, RenderState, SavedPerformance } from './model'
import { PERFORMANCE_STORAGE_KEY, savePerformance } from './persistence'
import { subscriptions } from './subscription'

const source = shaderExamples[0].source
const saved = SavedPerformance.make({
  sessionId: 'continued-performance',
  snapshot: Snapshot.make({
    source,
    controls: parseControls(source).controls.map(control =>
      modifyFields(control, { value: () => control.max }),
    ),
    startedAt: 1234,
    revision: 456,
  }),
  microphoneBindings: [
    { name: 'bass', bands: [2, 3], gain: 2, maybeColor: Option.none() },
  ],
  oscillatorBindings: [
    {
      name: 'warp',
      waveform: 'square',
      period: 7,
      depth: 35,
      phase: 90,
      maybeColor: Option.none(),
    },
  ],
  midiBindings: [
    {
      name: 'speed',
      maybeSource: Option.some({
        inputId: 'midi-keyboard',
        inputName: 'Keys',
        kind: 'cc',
        channel: 3,
        number: 42,
      }),
      maybePendingValue: Option.none(),
      maybeColor: Option.none(),
    },
  ],
  isMicrophoneEnabled: true,
})
const restored = () =>
  init({
    mode: 'control',
    sessionId: saved.sessionId,
    startedAt: 9999,
    maybeSavedPerformance: Option.some(saved),
  }).model

afterEach(() => {
  localStorage.removeItem(PERFORMANCE_STORAGE_KEY)
  window.history.replaceState(null, '', '/')
})

test('refresh recompiles the saved shader with tuned controls, mappings and its original clock', () => {
  const nextSnapshot = modifyFields(saved.snapshot, {
    revision: revision => revision + 1,
  })
  story(
    update,
    given(restored()),
    model(current => {
      expect(current.source).toBe(source)
      expect(current.startedAt).toBe(saved.snapshot.startedAt)
      expect(current.microphone._tag).toBe('Starting')
      expect(current.midi._tag).toBe('Starting')
      expect(
        subscriptions.microphone.modelToDependencies(current).maybeSession,
      ).toEqual(Option.some(0))
      expect(
        subscriptions.midi.modelToDependencies(current).maybeSession,
      ).toEqual(Option.some(0))
    }),
    message(Message.SucceededMountRenderer()),
    Command.expectExact(RenderShader({ snapshot: nextSnapshot })),
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
      expect(current.microphoneBindings).toEqual(saved.microphoneBindings)
      expect(current.oscillatorBindings).toEqual(saved.oscillatorBindings)
      expect(current.midiBindings).toEqual(saved.midiBindings)
      expect(
        current.oscillatorBindings.some(binding => binding.name === 'hue'),
      ).toBe(false)
    }),
  )
})

test('a rejected edit keeps the saved live source and mappings available for persistence', () => {
  const ready = update(restored(), Message.SucceededMountRenderer())
  const live = update(
    ready.model,
    Message.CompletedRenderShader({
      snapshot: saved.snapshot,
      diagnostics: [],
    }),
  ).model
  const draft = update(
    live,
    Message.UpdatedSource({ source: 'broken WGSL' }),
  ).model
  const compiling = update(draft, Message.PressedRender()).model
  const failed = update(
    compiling,
    Message.CompletedRenderShader({
      snapshot: modifyFields(saved.snapshot, { source: () => 'broken WGSL' }),
      diagnostics: [
        {
          id: 'compile',
          line: 1,
          column: 1,
          severity: 'error',
          message: 'Invalid WGSL',
        },
      ],
    }),
  ).model
  expect(failed.source).toBe('broken WGSL')
  expect(failed.maybeLive).toEqual(Option.some(saved.snapshot))
  expect(failed.microphoneBindings).toEqual(saved.microphoneBindings)
})

test('flags reuse the saved session and a matching projection can resume before its handshake', async () => {
  await Effect.runPromise(savePerformance(saved))
  const controlFlags = await Effect.runPromise(flags)
  expect(controlFlags.sessionId).toBe(saved.sessionId)
  expect(controlFlags.maybeSavedPerformance).toEqual(Option.some(saved))

  window.history.replaceState(
    null,
    '',
    `/?view=projection&session=${saved.sessionId}`,
  )
  const projection = init(await Effect.runPromise(flags)).model
  expect(projection.mode).toBe('projection')
  expect(projection.maybeLive).toEqual(Option.none())
  expect(projection.microphoneBindings).toEqual([])
  expect(projection.oscillatorBindings).toEqual([])
  expect(projection.midiBindings).toEqual([])
  story(
    update,
    given(projection),
    message(Message.SucceededMountRenderer()),
    Command.expectExact(RenderShader({ snapshot: saved.snapshot })),
    Command.resolve(
      RenderShader,
      Message.CompletedRenderShader({
        snapshot: saved.snapshot,
        diagnostics: [],
      }),
    ),
    Command.resolve(BroadcastState, Message.CompletedBroadcastState()),
  )

  window.history.replaceState(
    null,
    '',
    '/?view=projection&session=other-performance',
  )
  const unrelated = await Effect.runPromise(flags)
  expect(unrelated.maybeSavedPerformance).toEqual(Option.none())
  expect(unrelated.sessionId).toBe('other-performance')
})

test('a refreshed controller catches up with an open projection ahead of storage, including queued renders', () => {
  const active = modifyFields(saved.snapshot, { revision: () => 10000 })
  const queued = modifyFields(active, { revision: () => 12000 })
  const projection = modifyFields(restored(), {
    mode: () => 'projection',
    engine: () => EngineState.Ready(),
    render: () => RenderState.Compiling({ draftGeneration: 0 }),
    maybeLive: () => Option.some(active),
    maybeIncoming: () => Option.some(queued),
  })
  const hello = update(restored(), Message.SucceededMountChannel())
  expect(hello.commands).toMatchObject([
    { name: 'BroadcastState', args: { broadcast: Broadcast.Hello() } },
  ])
  const reply = update(
    projection,
    Message.ReceivedBroadcast({ broadcast: Broadcast.Hello() }),
  )
  const revision = Broadcast.Revision({ revision: queued.revision })
  expect(reply.commands).toMatchObject([
    { name: 'BroadcastState', args: { broadcast: revision } },
  ])

  const mounted = update(restored(), Message.SucceededMountRenderer())
  const ready = update(
    mounted.model,
    Message.CompletedRenderShader({
      snapshot: saved.snapshot,
      diagnostics: [],
    }),
  )
  const resumed = update(
    ready.model,
    Message.ReceivedBroadcast({ broadcast: revision }),
  )
  const snapshot = modifyFields(saved.snapshot, { revision: () => 12001 })
  expect(resumed.commands).toMatchObject([
    {
      name: 'BroadcastState',
      args: { broadcast: Broadcast.State({ snapshot }) },
    },
  ])
  const synchronized = update(
    projection,
    Message.ReceivedBroadcast({ broadcast: Broadcast.State({ snapshot }) }),
  )
  expect(synchronized.model.maybeIncoming).toEqual(Option.some(snapshot))
  const finished = update(
    synchronized.model,
    Message.CompletedRenderShader({ snapshot: active, diagnostics: [] }),
  )
  expect(finished.model.maybeLive).toEqual(Option.some(snapshot))
  expect(finished.commands).toMatchObject([
    { name: 'SyncControls', args: { snapshot } },
  ])
  expect(
    update(resumed.model, Message.ReceivedBroadcast({ broadcast: revision })),
  ).toEqual({ model: resumed.model })
})

test('a projection revision received during controller restoration survives the in-flight compilation', () => {
  const snapshot = modifyFields(saved.snapshot, {
    revision: revision => revision + 1,
  })
  const mounted = update(restored(), Message.SucceededMountRenderer())
  const resumed = update(
    mounted.model,
    Message.ReceivedBroadcast({
      broadcast: Broadcast.Revision({ revision: 12000 }),
    }),
  )
  expect(resumed.commands).toBeUndefined()
  const completed = update(
    resumed.model,
    Message.CompletedRenderShader({ snapshot, diagnostics: [] }),
  )
  const rebased = modifyFields(snapshot, { revision: () => 12002 })
  expect(completed.model.maybeLive).toEqual(Option.some(rebased))
  expect(completed.commands).toMatchObject([
    {
      name: 'BroadcastState',
      args: { broadcast: Broadcast.State({ snapshot: rebased }) },
    },
    { name: 'ShowDiagnostics' },
  ])
})

test('a controller receives the projection revision before GPU readiness without broadcasting stale state', () => {
  const resumed = update(
    restored(),
    Message.ReceivedBroadcast({
      broadcast: Broadcast.Revision({ revision: 12000 }),
    }),
  )
  expect(resumed.commands).toBeUndefined()
  const mounted = update(resumed.model, Message.SucceededMountRenderer())
  expect(mounted.commands).toMatchObject([
    {
      name: 'RenderShader',
      args: {
        snapshot: modifyFields(saved.snapshot, { revision: () => 12002 }),
      },
    },
  ])
})
