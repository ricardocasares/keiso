import { Effect, Schema, Stream } from 'effect'
import { Subscription } from 'foldkit'

import { errorReason, renderer, streamChannel } from './host'
import { Message } from './message'
import type { Model } from './model'

export const subscriptions = Subscription.make<Model, Message>()(entry => ({
  channel: entry(
    {
      sessionId: Schema.String,
      mode: Schema.Literals(['control', 'projection']),
    },
    {
      modelToDependencies: model => ({
        sessionId: model.sessionId,
        mode: model.mode,
      }),
      dependenciesToStream: ({ sessionId, mode }) =>
        streamChannel(sessionId, mode),
    },
  ),
  renderShortcut: entry(
    { isControl: Schema.Boolean },
    {
      modelToDependencies: model => ({ isControl: model.mode === 'control' }),
      dependenciesToStream: ({ isControl }) =>
        isControl
          ? Subscription.keyBindings({
              bindings: [
                {
                  keys: 'Meta+Enter',
                  whileTyping: 'Allow',
                  preventDefault: true,
                  mapEvent: () => Message.PressedRender(),
                },
                {
                  keys: 'Control+Enter',
                  whileTyping: 'Allow',
                  preventDefault: true,
                  mapEvent: () => Message.PressedRender(),
                },
              ],
            })
          : Stream.empty,
    },
  ),
  validation: entry(
    { source: Schema.String, isReady: Schema.Boolean },
    {
      modelToDependencies: model => ({
        source: model.source,
        isReady: model.mode === 'control' && model.engine._tag === 'Ready',
      }),
      dependenciesToStream: ({ source, isReady }) =>
        !isReady
          ? Stream.empty
          : Stream.fromEffect(
              Effect.gen(function* () {
                yield* Effect.sleep('350 millis')
                const engine = yield* renderer()
                const diagnostics = yield* Effect.tryPromise(() =>
                  engine.validate(source),
                )
                return Message.CompletedValidateShader({ source, diagnostics })
              }).pipe(
                Effect.catch(error =>
                  Effect.succeed(
                    Message.CompletedValidateShader({
                      source,
                      diagnostics: [
                        {
                          line: 1,
                          column: 1,
                          id: 'validation-error',
                          severity: 'error',
                          message: errorReason(error),
                        },
                      ],
                    }),
                  ),
                ),
              ),
            ),
    },
  ),
}))
