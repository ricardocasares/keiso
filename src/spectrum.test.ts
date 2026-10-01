import { Effect, Fiber, Stream } from 'effect'
import { expect, test, vi } from 'vitest'

import { spectrumBands } from './audio'
import { Message } from './message'
import { MountSpectrumSelection } from './spectrum'

test('pointer strokes capture movement, end outside or on cancel, and preserve keyboard clicks', async () => {
  const element = document.createElement('div')
  const bars = spectrumBands.map((_, index) => {
    const button = document.createElement('button')
    button.dataset.spectrumBand = String(index)
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(index * 10, 0, 10, 72),
    )
    element.append(button)
    return button
  })
  document.body.append(element)
  const captured = new Set<number>()
  element.setPointerCapture = vi.fn(id => {
    captured.add(id)
  })
  element.hasPointerCapture = id => captured.has(id)
  element.releasePointerCapture = vi.fn(id => {
    captured.delete(id)
  })
  const received: Array<Message> = []
  const fiber = Effect.runFork(
    Stream.runForEach(
      MountSpectrumSelection().f(element, Stream.make('Live')),
      message =>
        Effect.sync(() => {
          received.push(message)
        }),
    ),
  )
  const send = (
    target: EventTarget,
    type: string,
    clientX: number,
    pointerId = 7,
    isPrimary = true,
  ) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        pointerId,
        isPrimary,
        pointerType: 'mouse',
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX,
        bubbles: true,
        cancelable: true,
      }),
    )
  const clicked = vi.fn()
  const first = bars[0]!
  first.addEventListener('click', clicked)
  try {
    await Effect.runPromise(Effect.sleep(0))
    send(first, 'pointerdown', 5)
    expect(element.setPointerCapture).toHaveBeenCalledWith(7)
    send(document, 'pointermove', 205, 8, false)
    send(document, 'pointermove', 65)
    send(document, 'pointerup', 1000)
    await Effect.runPromise(Effect.sleep(0))
    expect(received).toEqual([
      Message.StartedSpectrumSelection({ index: 0 }),
      Message.MovedSpectrumSelection({ index: 6 }),
      Message.MovedSpectrumSelection({ index: 63 }),
      Message.EndedSpectrumSelection(),
    ])
    first.dispatchEvent(
      new MouseEvent('click', { detail: 1, bubbles: true, cancelable: true }),
    )
    expect(clicked).not.toHaveBeenCalled()
    first.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true }))
    expect(clicked).toHaveBeenCalledOnce()
    send(document, 'pointermove', 25)
    send(first, 'pointerdown', 5)
    send(document, 'pointercancel', 15)
    send(document, 'pointermove', 35)
    send(first, 'pointerdown', 5)
    window.dispatchEvent(new Event('blur'))
    await Effect.runPromise(Effect.sleep(0))
    expect(received.slice(4)).toEqual([
      Message.StartedSpectrumSelection({ index: 0 }),
      Message.EndedSpectrumSelection(),
      Message.StartedSpectrumSelection({ index: 0 }),
      Message.EndedSpectrumSelection(),
    ])
  } finally {
    await Effect.runPromise(Fiber.interrupt(fiber))
    element.remove()
  }
  expect(captured.size).toBe(0)
  send(first, 'pointerdown', 5)
  expect(element.setPointerCapture).toHaveBeenCalledTimes(3)
})
