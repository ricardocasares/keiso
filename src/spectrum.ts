import { Effect, Queue, Stream } from 'effect'
import { Mount } from 'foldkit'

import { spectrumBands } from './audio'
import { Message } from './message'

export const MountSpectrumSelection = Mount.defineStream(
  'MountSpectrumSelection',
  {
    messages: [
      Message.StartedSpectrumSelection,
      Message.MovedSpectrumSelection,
      Message.EndedSpectrumSelection,
    ],
    execute: ({ element, viewStateChanges }) =>
      Stream.callback<
        | typeof Message.StartedSpectrumSelection.Type
        | typeof Message.MovedSpectrumSelection.Type
        | typeof Message.EndedSpectrumSelection.Type
      >(queue =>
        Effect.gen(function* () {
          if (!(element instanceof HTMLElement)) {
            return yield* Effect.never
          }
          const pointer: { id?: number; lastIndex?: number; isLive: boolean } =
            { isLive: true }
          const finish = () => {
            const id = pointer.id
            if (id === undefined) {
              return
            }
            delete pointer.id
            delete pointer.lastIndex
            if (element.hasPointerCapture(id)) {
              element.releasePointerCapture(id)
            }
            Queue.offerUnsafe(queue, Message.EndedSpectrumSelection())
          }
          const moveTo = (clientX: number) => {
            const first = element.firstElementChild?.getBoundingClientRect()
            const last = element.lastElementChild?.getBoundingClientRect()
            if (!first || !last || last.right <= first.left) {
              return
            }
            const index = Math.max(
              0,
              Math.min(
                spectrumBands.length - 1,
                Math.floor(
                  ((clientX - first.left) / (last.right - first.left)) *
                    spectrumBands.length,
                ),
              ),
            )
            if (index !== pointer.lastIndex) {
              pointer.lastIndex = index
              Queue.offerUnsafe(
                queue,
                Message.MovedSpectrumSelection({ index }),
              )
            }
          }
          const move = (event: PointerEvent) => {
            if (event.pointerId !== pointer.id) {
              return
            }
            if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
              finish()
              return
            }
            moveTo(event.clientX)
          }
          const down = (event: PointerEvent) => {
            if (
              !pointer.isLive ||
              pointer.id !== undefined ||
              !event.isPrimary ||
              event.button !== 0
            ) {
              return
            }
            const button =
              event.target instanceof Element
                ? event.target.closest<HTMLButtonElement>(
                    'button[data-spectrum-band]',
                  )
                : null
            if (!button || !element.contains(button)) {
              return
            }
            const index = Number(button.dataset.spectrumBand)
            if (
              !Number.isInteger(index) ||
              index < 0 ||
              index >= spectrumBands.length
            ) {
              return
            }
            event.preventDefault()
            element.setPointerCapture(event.pointerId)
            pointer.id = event.pointerId
            pointer.lastIndex = index
            button.focus({ preventScroll: true })
            Queue.offerUnsafe(
              queue,
              Message.StartedSpectrumSelection({ index }),
            )
          }
          const end = (event: PointerEvent) => {
            if (event.pointerId === pointer.id) {
              if (event.type === 'pointerup') {
                moveTo(event.clientX)
              }
              finish()
            }
          }
          const click = (event: MouseEvent) => {
            if (event.detail > 0) {
              event.preventDefault()
              event.stopImmediatePropagation()
            }
          }
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              element.addEventListener('pointerdown', down)
              element.addEventListener('lostpointercapture', end)
              element.addEventListener('click', click, true)
              document.addEventListener('pointermove', move)
              document.addEventListener('pointerup', end)
              document.addEventListener('pointercancel', end)
              window.addEventListener('blur', finish)
            }),
            () =>
              Effect.sync(() => {
                element.removeEventListener('pointerdown', down)
                element.removeEventListener('lostpointercapture', end)
                element.removeEventListener('click', click, true)
                document.removeEventListener('pointermove', move)
                document.removeEventListener('pointerup', end)
                document.removeEventListener('pointercancel', end)
                window.removeEventListener('blur', finish)
                finish()
              }),
          )
          yield* Stream.runForEach(viewStateChanges, state =>
            Effect.sync(() => {
              pointer.isLive = state === 'Live'
              if (!pointer.isLive) {
                finish()
              }
            }),
          ).pipe(Effect.forkScoped)
          return yield* Effect.never
        }),
      ),
  },
)
