import { Effect, Fiber, Option, Stream } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { expect, test, vi } from 'vitest'

import { Snapshot } from './domain/session'
import { parseControls } from './domain/shader'
import { init, update } from './main'
import { Message } from './message'
import { EngineState, RenderState } from './model'
import { subscriptions } from './subscription'

test('render shortcuts bypass a focused listbox trigger and ignore plain Enter, composition, and repeats', async () => {
  const trigger = document.createElement('button')
  trigger.setAttribute('aria-haspopup', 'listbox')
  const handleEnter = vi.fn((event: KeyboardEvent) => event.preventDefault())
  trigger.addEventListener('keydown', handleEnter)
  document.body.append(trigger)
  trigger.focus()

  const received: Array<Message> = []
  const fiber = Effect.runFork(
    Stream.runForEach(
      subscriptions.renderShortcut.dependenciesToStream({ isControl: true }),
      message => Effect.sync(() => received.push(message)),
    ),
  )
  const press = (modifiers: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      ...modifiers,
    })
    trigger.dispatchEvent(event)
    return event
  }

  try {
    await Effect.runPromise(Effect.sleep(0))
    expect(document.activeElement).toBe(trigger)
    expect(press({ metaKey: true }).defaultPrevented).toBe(true)
    expect(press({ ctrlKey: true }).defaultPrevented).toBe(true)
    expect(handleEnter).not.toHaveBeenCalled()

    press({})
    press({ metaKey: true, isComposing: true })
    press({ ctrlKey: true, repeat: true })
    expect(handleEnter).toHaveBeenCalledTimes(3)
    await Effect.runPromise(Effect.sleep(0))
    expect(received).toEqual([Message.PressedRender(), Message.PressedRender()])
  } finally {
    await Effect.runPromise(Fiber.interrupt(fiber))
    trigger.remove()
  }
})

test('oscillator subscription emits clock timestamps only while a live oscillator can run', async () => {
  const initial = init({
    mode: 'control',
    sessionId: 'clock-test',
    startedAt: 1000,
    maybeSavedPerformance: Option.none(),
  }).model
  const live = modifyFields(initial, {
    engine: () => EngineState.Ready(),
    maybeLive: () =>
      Option.some(
        Snapshot.make({
          source: initial.source,
          controls: parseControls(initial.source).controls,
          startedAt: initial.startedAt,
          revision: 1,
        }),
      ),
  })
  const bound = update(
    live,
    Message.SelectedControlInput({ name: 'speed', input: 'oscillator' }),
  ).model
  const dependencies = subscriptions.oscillators.modelToDependencies
  expect(dependencies(bound)).toEqual({ isActive: true })
  const inactive = [
    initial,
    live,
    modifyFields(bound, { mode: () => 'projection' }),
    modifyFields(bound, {
      render: () => RenderState.Compiling({ draftGeneration: 0 }),
    }),
    modifyFields(bound, {
      engine: () => EngineState.Failed({ reason: 'lost' }),
    }),
  ]
  inactive.forEach(current =>
    expect(dependencies(current)).toEqual({ isActive: false }),
  )
  const messages = await Effect.runPromise(
    subscriptions.oscillators
      .dependenciesToStream({ isActive: true })
      .pipe(Stream.take(1), Stream.runCollect),
  )
  expect(messages).toEqual([
    Message.TickedOscillators({ now: expect.any(Number) }),
  ])
  expect(
    await Effect.runPromise(
      subscriptions.oscillators
        .dependenciesToStream({ isActive: false })
        .pipe(Stream.runCollect),
    ),
  ).toEqual([])
})
