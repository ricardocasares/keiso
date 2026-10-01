import { Effect, Fiber, Stream } from 'effect'
import { expect, test, vi } from 'vitest'

import { Message } from './message'
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
