import { Array, Clock, Effect, Option, Schema, Stream } from 'effect'
import { Subscription } from 'foldkit'

import { streamMicrophone } from './audio'
import { errorReason, renderer, streamChannel } from './host'
import { Message } from './message'
import type { Model } from './model'

export const subscriptions = Subscription.make<Model, Message>()(entry => ({
  oscillators: entry(
    { isActive: Schema.Boolean },
    {
      modelToDependencies: model => ({
        isActive:
          model.mode === 'control' &&
          model.engine._tag === 'Ready' &&
          model.render._tag !== 'Compiling' &&
          Option.isSome(model.maybeLive) &&
          Array.isReadonlyArrayNonEmpty(model.oscillatorBindings),
      }),
      dependenciesToStream: ({ isActive }) =>
        isActive
          ? // ponytail: background tabs throttle this timer; sample in the projection renderer if background performance is needed.
            Stream.tick('33 millis').pipe(
              Stream.mapEffect(() => Clock.currentTimeMillis),
              Stream.map(now => Message.TickedOscillators({ now })),
            )
          : Stream.empty,
    },
  ),
  microphone: entry(
    { maybeSession: Schema.Option(Schema.Number) },
    {
      modelToDependencies: model => ({
        maybeSession:
          model.mode === 'control' &&
          (model.microphone._tag === 'Starting' ||
            model.microphone._tag === 'Ready')
            ? Option.some(model.microphoneSession)
            : Option.none(),
      }),
      dependenciesToStream: ({ maybeSession }) =>
        Option.match(maybeSession, {
          onNone: () => Stream.empty,
          onSome: streamMicrophone,
        }),
    },
  ),
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
          ? Subscription.fromEventFilterMapPreventDefault({
              target: () => window,
              type: 'keydown',
              options: { capture: true },
              filterMapEvent: event => {
                if (
                  event.defaultPrevented ||
                  event.isComposing ||
                  event.repeat ||
                  event.key !== 'Enter' ||
                  event.altKey ||
                  event.shiftKey ||
                  !(event.metaKey || event.ctrlKey)
                ) {
                  return Option.none()
                }
                event.stopPropagation()
                return Option.some(Message.PressedRender())
              },
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
