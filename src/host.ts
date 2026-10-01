import { Effect, Option, Queue, Schema, Stream } from 'effect'
import { Mount } from 'foldkit'

import { Broadcast } from './domain/session'
import type { ShaderEditor } from './editor'
import { Message } from './message'
import { type Renderer, createRenderer } from './renderer'

const handles: {
  renderer?: Renderer
  editor?: ShaderEditor
  channel?: BroadcastChannel
} = {}

export const renderer = () =>
  Effect.try(() => {
    if (!handles.renderer) {
      throw new Error('WebGPU is not ready.')
    }
    return handles.renderer
  })
export const editor = () =>
  Effect.try(() => {
    if (!handles.editor) {
      throw new Error('The editor is not ready.')
    }
    return handles.editor
  })
export const channel = () =>
  Effect.try(() => {
    if (!handles.channel) {
      throw new Error('BroadcastChannel is not ready.')
    }
    return handles.channel
  })
export const errorReason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const MountRenderer = Mount.defineStream('MountRenderer', {
  messages: [
    Message.SucceededMountRenderer,
    Message.FailedMountRenderer,
    Message.FailedRenderer,
  ],
  execute: ({ element }) =>
    Stream.callback<
      | typeof Message.SucceededMountRenderer.Type
      | typeof Message.FailedMountRenderer.Type
      | typeof Message.FailedRenderer.Type
    >(queue =>
      Effect.gen(function* () {
        if (!(element instanceof HTMLCanvasElement)) {
          Queue.offerUnsafe(
            queue,
            Message.FailedMountRenderer({ reason: 'Canvas is unavailable.' }),
          )
          return yield* Effect.never
        }
        yield* Effect.acquireRelease(
          Effect.tryPromise(() =>
            createRenderer(element, reason =>
              Queue.offerUnsafe(queue, Message.FailedRenderer({ reason })),
            ),
          ).pipe(
            Effect.tap(value =>
              Effect.sync(() => {
                handles.renderer = value
              }),
            ),
          ),
          value =>
            Effect.sync(() => {
              value.dispose()
              if (handles.renderer === value) {
                delete handles.renderer
              }
            }),
        )
        Queue.offerUnsafe(queue, Message.SucceededMountRenderer())
        return yield* Effect.never
      }).pipe(
        Effect.catch(error =>
          Effect.sync(() => {
            Queue.offerUnsafe(
              queue,
              Message.FailedMountRenderer({ reason: errorReason(error) }),
            )
          }),
        ),
      ),
    ),
})

export const MountEditor = Mount.defineStream('MountEditor', {
  args: { source: Schema.String },
  messages: [
    Message.SucceededMountEditor,
    Message.FailedMountEditor,
    Message.UpdatedSource,
    Message.PressedRender,
  ],
  execute: ({ element, source, viewStateChanges }) =>
    Stream.callback<
      | typeof Message.SucceededMountEditor.Type
      | typeof Message.FailedMountEditor.Type
      | typeof Message.UpdatedSource.Type
      | typeof Message.PressedRender.Type
    >(queue =>
      Effect.gen(function* () {
        if (!(element instanceof HTMLElement)) {
          return yield* Effect.fail(new Error('Editor host unavailable.'))
        }
        const module = yield* Effect.tryPromise(() => import('./editor'))
        const mountedEditor = yield* Effect.acquireRelease(
          Effect.try(() =>
            module.createEditor(
              element,
              source,
              source =>
                Queue.offerUnsafe(queue, Message.UpdatedSource({ source })),
              () => Queue.offerUnsafe(queue, Message.PressedRender()),
            ),
          ),
          value =>
            Effect.sync(() => {
              value.dispose()
              if (handles.editor === value) {
                delete handles.editor
              }
            }),
        )
        handles.editor = mountedEditor
        yield* Stream.runForEach(viewStateChanges, state =>
          Effect.sync(() => mountedEditor.setReadOnly(state !== 'Live')),
        ).pipe(Effect.forkScoped)
        Queue.offerUnsafe(queue, Message.SucceededMountEditor())
        return yield* Effect.never
      }).pipe(
        Effect.catch(error =>
          Effect.sync(() => {
            Queue.offerUnsafe(
              queue,
              Message.FailedMountEditor({ reason: errorReason(error) }),
            )
          }),
        ),
      ),
    ),
})

export const streamChannel = (
  sessionId: string,
  mode: 'control' | 'projection',
) =>
  Stream.callback<
    | typeof Message.SucceededMountChannel.Type
    | typeof Message.FailedMountChannel.Type
    | typeof Message.ReceivedBroadcast.Type
  >(queue =>
    Effect.gen(function* () {
      const connection = yield* Effect.acquireRelease(
        Effect.try(() => new BroadcastChannel(`codegl:${sessionId}`)),
        value =>
          Effect.sync(() => {
            value.close()
            if (handles.channel === value) {
              delete handles.channel
            }
          }),
      )
      handles.channel = connection
      connection.onmessage = event => {
        const maybeBroadcast = Schema.decodeUnknownOption(Broadcast)(event.data)
        Option.match(maybeBroadcast, {
          onNone: () => {},
          onSome: broadcast =>
            Queue.offerUnsafe(queue, Message.ReceivedBroadcast({ broadcast })),
        })
      }
      Queue.offerUnsafe(queue, Message.SucceededMountChannel())
      if (mode === 'projection') {
        connection.postMessage(Broadcast.Hello())
      }
      return yield* Effect.never
    }).pipe(
      Effect.catch(error =>
        Effect.sync(() => {
          Queue.offerUnsafe(
            queue,
            Message.FailedMountChannel({ reason: errorReason(error) }),
          )
        }),
      ),
    ),
  )
