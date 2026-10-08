import { Effect, Queue, Schema, Stream } from 'effect'
import { Mount } from 'foldkit'

import { Anchor } from '@foldkit/ui'

import { parseControls } from './domain/shader'
import { errorReason } from './host'
import { Message } from './message'
import { createRenderer } from './renderer'

export const MountGeneratedPreview = Mount.defineStream(
  'MountGeneratedPreview',
  {
    args: { source: Schema.String, startedAt: Schema.Number },
    messages: [
      Message.SucceededMountGeneratedPreview,
      Message.FailedMountGeneratedPreview,
    ],
    execute: ({ element, source, startedAt }) =>
      Stream.callback<
        | typeof Message.SucceededMountGeneratedPreview.Type
        | typeof Message.FailedMountGeneratedPreview.Type
      >(queue =>
        Effect.gen(function* () {
          const canvas = element.querySelector('canvas')
          if (
            !(element instanceof HTMLElement) ||
            !(canvas instanceof HTMLCanvasElement)
          ) {
            return yield* Effect.fail(
              new Error('Preview canvas is unavailable.'),
            )
          }
          yield* Effect.acquireRelease(
            Effect.try({
              try: () =>
                Anchor.anchorSetup(element, {
                  buttonId: 'ai-apply',
                  anchor: { placement: 'top-end', gap: 8, padding: 12 },
                  interceptTab: false,
                }),
              catch: errorReason,
            }),
            cleanup => Effect.sync(cleanup),
          )
          const preview = yield* Effect.acquireRelease(
            Effect.tryPromise({
              try: () =>
                createRenderer(canvas, reason =>
                  Queue.offerUnsafe(
                    queue,
                    Message.FailedMountGeneratedPreview({ source, reason }),
                  ),
                ),
              catch: errorReason,
            }),
            value => Effect.sync(() => value.dispose()),
          )
          const diagnostics = yield* Effect.tryPromise({
            try: () =>
              preview.render(source, parseControls(source).controls, startedAt),
            catch: errorReason,
          })
          const failure = diagnostics.find(
            diagnostic => diagnostic.severity === 'error',
          )
          if (failure) {
            return yield* Effect.fail(new Error(failure.message))
          }
          Queue.offerUnsafe(
            queue,
            Message.SucceededMountGeneratedPreview({ source }),
          )
          return yield* Effect.never
        }).pipe(
          Effect.catch(error =>
            Effect.sync(() => {
              Queue.offerUnsafe(
                queue,
                Message.FailedMountGeneratedPreview({
                  source,
                  reason: errorReason(error),
                }),
              )
            }),
          ),
        ),
      ),
  },
)
