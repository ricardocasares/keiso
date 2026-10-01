import { Array, Clock, Effect, Option, Schema } from 'effect'
import { Command, type Runtime, type Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { Broadcast, Snapshot } from './domain/session'
import { Diagnostic, parseControls } from './domain/shader'
import { shaderExamples } from './examples'
import { channel, editor, errorReason, renderer } from './host'
import { Message } from './message'
import { EngineState, Flags, Model, RenderState, Validation } from './model'

export { Message } from './message'
export { Model } from './model'
export { view } from './view'

// FLAGS

export const flags = Effect.gen(function* () {
  const startedAt = yield* Clock.currentTimeMillis
  return yield* Effect.sync(() => {
    const parameters = new URLSearchParams(window.location.search)
    const session = parameters.get('session')
    return Flags.make({
      mode:
        parameters.get('view') === 'projection' && session
          ? 'projection'
          : 'control',
      sessionId: session || crypto.randomUUID(),
      startedAt,
    })
  })
})

export const init: Runtime.ApplicationInit<Model, Message, Flags> = flags => ({
  model: Model.make({
    mode: flags.mode,
    sessionId: flags.sessionId,
    startedAt: flags.startedAt,
    source: shaderExamples[0].source,
    exampleId: shaderExamples[0].id,
    engine: EngineState.Starting(),
    validation: Validation.Checking(),
    render: RenderState.Idle(),
    maybeLive: Option.none(),
    maybeIncoming: Option.none(),
    maybeNotice: Option.none(),
    projectionStatus: 'Output ready to connect',
    isHelpOpen: false,
  }),
})

// COMMAND

const failureDiagnostic = (error: unknown): Diagnostic => ({
  line: 1,
  column: 1,
  id: 'validation-error',
  severity: 'error',
  message: errorReason(error),
})

export const RenderShader = Command.define('RenderShader', {
  args: { snapshot: Snapshot },
  messages: [Message.CompletedRenderShader],
  execute: ({ snapshot }) =>
    renderer().pipe(
      Effect.flatMap(value =>
        Effect.tryPromise(() =>
          value.render(snapshot.source, snapshot.controls, snapshot.startedAt),
        ),
      ),
      Effect.catch(error => Effect.succeed([failureDiagnostic(error)])),
      Effect.map(diagnostics =>
        Message.CompletedRenderShader({ snapshot, diagnostics }),
      ),
    ),
})

export const UpdateEditor = Command.define('UpdateEditor', {
  args: { source: Schema.String, diagnostics: Schema.Array(Diagnostic) },
  messages: [Message.CompletedUpdateEditor, Message.FailedUpdateEditor],
  execute: ({ source, diagnostics }) =>
    editor().pipe(
      Effect.flatMap(value =>
        Effect.try(() => {
          value.setSource(source)
          value.setDiagnostics(diagnostics, source)
        }),
      ),
      Effect.as(Message.CompletedUpdateEditor()),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedUpdateEditor({ reason: errorReason(error) }),
        ),
      ),
    ),
})

export const ShowDiagnostics = Command.define('ShowDiagnostics', {
  args: { source: Schema.String, diagnostics: Schema.Array(Diagnostic) },
  messages: [Message.CompletedShowDiagnostics],
  execute: ({ source, diagnostics }) =>
    editor().pipe(
      Effect.flatMap(value =>
        Effect.try(() => value.setDiagnostics(diagnostics, source)),
      ),
      Effect.ignore,
      Effect.as(Message.CompletedShowDiagnostics()),
    ),
})

export const BroadcastState = Command.define('BroadcastState', {
  args: { broadcast: Broadcast },
  messages: [Message.CompletedBroadcastState, Message.FailedBroadcastState],
  execute: ({ broadcast }) =>
    channel().pipe(
      Effect.flatMap(value => Effect.try(() => value.postMessage(broadcast))),
      Effect.as(Message.CompletedBroadcastState()),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedBroadcastState({ reason: errorReason(error) }),
        ),
      ),
    ),
})

export const SyncControls = Command.define('SyncControls', {
  args: { snapshot: Snapshot },
  messages: [Message.CompletedSyncControls, Message.FailedSyncControls],
  execute: ({ snapshot }) =>
    renderer().pipe(
      Effect.flatMap(value =>
        Effect.try(() => value.setControls(snapshot.controls)),
      ),
      Effect.as(Message.CompletedSyncControls()),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedSyncControls({ reason: errorReason(error) }),
        ),
      ),
    ),
})

export const OpenProjection = Command.define('OpenProjection', {
  args: { sessionId: Schema.String },
  messages: [Message.CompletedOpenProjection, Message.FailedOpenProjection],
  execute: ({ sessionId }) =>
    Effect.try(() => {
      const url = new URL(window.location.href)
      url.search = new URLSearchParams({
        view: 'projection',
        session: sessionId,
      }).toString()
      const projection = window.open(
        url,
        '_blank',
        'popup,width=1280,height=720',
      )
      if (!projection) {
        throw new Error(
          'Your browser blocked the projection window. Allow pop-ups for this site and try again.',
        )
      }
      projection.opener = null
      return Message.CompletedOpenProjection()
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedOpenProjection({ reason: errorReason(error) }),
        ),
      ),
    ),
})

export const FocusDiagnostic = Command.define('FocusDiagnostic', {
  args: { line: Schema.Number, column: Schema.Number },
  messages: [Message.CompletedFocusDiagnostic],
  execute: ({ line, column }) =>
    editor().pipe(
      Effect.flatMap(value => Effect.try(() => value.focusLine(line, column))),
      Effect.ignore,
      Effect.as(Message.CompletedFocusDiagnostic()),
    ),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message>
const hasErrors = (diagnostics: ReadonlyArray<Diagnostic>): boolean =>
  diagnostics.some(({ severity }) => severity === 'error')

const notice = (model: Model, reason: string): UpdateReturn => ({
  model: modifyFields(model, { maybeNotice: () => Option.some(reason) }),
})

const startRender = (model: Model, snapshot: Snapshot): UpdateReturn => ({
  model: modifyFields(model, {
    render: () => RenderState.Compiling(),
    maybeNotice: () => Option.none(),
  }),
  commands: [RenderShader({ snapshot })],
})

const renderDraft = (model: Model): UpdateReturn => {
  if (model.engine._tag !== 'Ready' || model.render._tag === 'Compiling') {
    return { model }
  }
  const parsed = parseControls(model.source)
  const controls = parsed.controls.map(control =>
    Option.match(model.maybeLive, {
      onNone: () => control,
      onSome: live => {
        const previous = live.controls.find(
          candidate => candidate.name === control.name,
        )
        return previous && live.source === model.source
          ? modifyFields(control, {
              value: () =>
                Math.min(control.max, Math.max(control.min, previous.value)),
            })
          : control
      },
    }),
  )
  const revision = Option.match(model.maybeLive, {
    onNone: () => 1,
    onSome: live => live.revision + 1,
  })
  return startRender(model, {
    source: model.source,
    controls,
    startedAt: model.startedAt,
    revision,
  })
}

const applyIncoming = (model: Model, snapshot: Snapshot): UpdateReturn => {
  if (
    Option.exists(
      model.maybeIncoming,
      incoming => incoming.revision > snapshot.revision,
    )
  ) {
    return { model }
  }
  const pendingModel = modifyFields(model, {
    maybeIncoming: () => Option.some(snapshot),
  })
  if (model.engine._tag !== 'Ready' || model.render._tag === 'Compiling') {
    return { model: pendingModel }
  }
  return Option.match(model.maybeLive, {
    onNone: () => startRender(pendingModel, snapshot),
    onSome: live => {
      if (snapshot.revision <= live.revision) {
        return { model }
      }
      if (snapshot.source !== live.source) {
        return startRender(pendingModel, snapshot)
      }
      return {
        model: modifyFields(pendingModel, {
          maybeLive: () => Option.some(snapshot),
        }),
        commands: [SyncControls({ snapshot })],
      }
    },
  })
}

const completedRender =
  (model: Model) =>
  ({
    snapshot,
    diagnostics,
  }: typeof Message.CompletedRenderShader.Type): UpdateReturn => {
    const isCurrentDraft = model.source === snapshot.source
    const completedModel = modifyFields(model, {
      render: () => RenderState.Idle(),
      validation: validation =>
        isCurrentDraft ? Validation.Checked({ diagnostics }) : validation,
    })
    if (hasErrors(diagnostics)) {
      const failedModel = modifyFields(completedModel, {
        maybeNotice: () =>
          Option.some(
            Option.isSome(model.maybeLive)
              ? 'Render rejected. The last good shader is still live.'
              : 'Render rejected. No shader is live yet.',
          ),
      })
      if (
        model.mode === 'projection' &&
        Option.exists(
          model.maybeIncoming,
          incoming => incoming.revision > snapshot.revision,
        )
      ) {
        return Option.match(model.maybeIncoming, {
          onNone: () => ({ model: failedModel }),
          onSome: incoming => applyIncoming(failedModel, incoming),
        })
      }
      return {
        model: failedModel,
        commands:
          model.mode === 'control'
            ? [ShowDiagnostics({ source: snapshot.source, diagnostics })]
            : [
                BroadcastState({
                  broadcast: Broadcast.Status({
                    reason: `Projection: ${diagnostics[0]?.message ?? 'render failed'}`,
                  }),
                }),
              ],
      }
    }
    const liveModel = modifyFields(completedModel, {
      maybeLive: () => Option.some(snapshot),
    })
    if (model.mode === 'projection') {
      return Option.match(model.maybeIncoming, {
        onNone: () => ({ model: liveModel }),
        onSome: incoming =>
          incoming.revision > snapshot.revision
            ? applyIncoming(liveModel, incoming)
            : {
                model: liveModel,
                commands: [
                  BroadcastState({
                    broadcast: Broadcast.Status({
                      reason: 'Projection is live',
                    }),
                  }),
                ],
              },
      })
    }
    return {
      model: liveModel,
      commands: [
        BroadcastState({ broadcast: Broadcast.State({ snapshot }) }),
        ShowDiagnostics({ source: snapshot.source, diagnostics }),
      ],
    }
  }

const receiveBroadcast =
  (model: Model) =>
  ({ broadcast }: typeof Message.ReceivedBroadcast.Type): UpdateReturn =>
    Broadcast.match(broadcast, {
      Hello: () =>
        model.mode === 'control'
          ? Option.match(model.maybeLive, {
              onNone: () => ({ model }),
              onSome: snapshot => ({
                model,
                commands: [
                  BroadcastState({ broadcast: Broadcast.State({ snapshot }) }),
                ],
              }),
            })
          : { model },
      State: ({ snapshot }) =>
        model.mode === 'projection'
          ? applyIncoming(model, snapshot)
          : { model },
      Status: ({ reason }) =>
        model.mode === 'control'
          ? { model: modifyFields(model, { projectionStatus: () => reason }) }
          : { model },
    })

const updateControl =
  (model: Model) =>
  ({ name, value }: typeof Message.UpdatedControl.Type): UpdateReturn => {
    if (!Number.isFinite(value) || model.render._tag === 'Compiling') {
      return { model }
    }
    return Option.match(model.maybeLive, {
      onNone: () => ({ model }),
      onSome: live => {
        const snapshot = modifyFields(live, {
          controls: Array.map(control =>
            control.name === name
              ? modifyFields(control, {
                  value: () =>
                    Math.min(control.max, Math.max(control.min, value)),
                })
              : control,
          ),
          revision: revision => revision + 1,
        })
        return {
          model: modifyFields(model, {
            maybeLive: () => Option.some(snapshot),
          }),
          commands: [
            SyncControls({ snapshot }),
            BroadcastState({ broadcast: Broadcast.State({ snapshot }) }),
          ],
        }
      },
    })
  }

const rendererFailed =
  (model: Model) =>
  ({ reason }: { reason: string }): UpdateReturn => {
    const failedModel = modifyFields(model, {
      engine: () => EngineState.Failed({ reason }),
    })
    return model.mode === 'projection'
      ? {
          model: failedModel,
          commands: [
            BroadcastState({
              broadcast: Broadcast.Status({
                reason: `Projection unavailable: ${reason}`,
              }),
            }),
          ],
        }
      : { model: failedModel }
  }

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    SucceededMountRenderer: () => {
      const readyModel = modifyFields(model, {
        engine: () => EngineState.Ready(),
      })
      return model.mode === 'control'
        ? renderDraft(readyModel)
        : Option.match(model.maybeIncoming, {
            onNone: () => ({ model: readyModel }),
            onSome: snapshot => applyIncoming(readyModel, snapshot),
          })
    },
    FailedMountRenderer: rendererFailed(model),
    FailedRenderer: rendererFailed(model),
    SucceededMountEditor: () => ({
      model,
      commands: [
        UpdateEditor({
          source: model.source,
          diagnostics:
            model.validation._tag === 'Checked'
              ? model.validation.diagnostics
              : [],
        }),
      ],
    }),
    FailedMountEditor: ({ reason }) => notice(model, reason),
    SucceededMountChannel: () =>
      model.mode === 'projection' && model.engine._tag === 'Failed'
        ? {
            model,
            commands: [
              BroadcastState({
                broadcast: Broadcast.Status({
                  reason: `Projection unavailable: ${model.engine.reason}`,
                }),
              }),
            ],
          }
        : { model },
    FailedMountChannel: ({ reason }) => notice(model, reason),
    UpdatedSource: ({ source }) => ({
      model: modifyFields(model, {
        source: () => source,
        validation: () => Validation.Checking(),
        maybeNotice: () => Option.none(),
      }),
    }),
    SelectedExample: ({ id }) =>
      Option.match(
        Array.findFirst(shaderExamples, example => example.id === id),
        {
          onNone: () => ({ model }),
          onSome: example => ({
            model: modifyFields(model, {
              source: () => example.source,
              exampleId: () => id,
              validation: () => Validation.Checking(),
              maybeNotice: () => Option.none(),
            }),
            commands: [
              UpdateEditor({ source: example.source, diagnostics: [] }),
            ],
          }),
        },
      ),
    PressedRender: () => renderDraft(model),
    CompletedValidateShader: ({ source, diagnostics }) =>
      source !== model.source
        ? { model }
        : {
            model: modifyFields(model, {
              validation: () => Validation.Checked({ diagnostics }),
            }),
            commands: [ShowDiagnostics({ source, diagnostics })],
          },
    CompletedRenderShader: completedRender(model),
    UpdatedControl: updateControl(model),
    ReceivedBroadcast: receiveBroadcast(model),
    CompletedSyncControls: () => ({ model }),
    FailedSyncControls: ({ reason }) => notice(model, reason),
    CompletedUpdateEditor: () => ({ model }),
    CompletedShowDiagnostics: () => ({ model }),
    FailedUpdateEditor: ({ reason }) => notice(model, reason),
    CompletedBroadcastState: () => ({ model }),
    FailedBroadcastState: ({ reason }) => notice(model, reason),
    ClickedProjection: () => ({
      model,
      commands: [OpenProjection({ sessionId: model.sessionId })],
    }),
    CompletedOpenProjection: () => ({
      model: modifyFields(model, {
        projectionStatus: () => 'Projection window opened',
        maybeNotice: () => Option.none(),
      }),
    }),
    FailedOpenProjection: ({ reason }) => notice(model, reason),
    ClickedDiagnostic: ({ line, column }) => ({
      model,
      commands: [FocusDiagnostic({ line, column })],
    }),
    CompletedFocusDiagnostic: () => ({ model }),
    ClickedHelp: () => ({
      model: modifyFields(model, { isHelpOpen: value => !value }),
    }),
  })
