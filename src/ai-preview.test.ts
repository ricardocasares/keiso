import { Effect, Fiber, Stream } from 'effect'
import { Mount } from 'foldkit'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { Anchor } from '@foldkit/ui'

import { MountGeneratedPreview } from './ai-preview'
import { type Diagnostic, parseControls } from './domain/shader'
import { Message } from './message'
import { type Renderer, createRenderer } from './renderer'

vi.mock('./renderer', () => ({ createRenderer: vi.fn() }))

afterEach(() => vi.resetAllMocks())
const cleanupAnchor = vi.fn()
beforeEach(() => {
  vi.spyOn(Anchor, 'anchorSetup').mockReturnValue(cleanupAnchor)
})

const source = `// @slider speed 0 10 2 0.1
fn fragment(uv: vec2f) -> vec4f { return vec4f(uv, speed, 1.0); }`
const startedAt = 1234
const makePreview = () => ({
  render: vi.fn(async (): Promise<ReadonlyArray<Diagnostic>> => []),
  validate: vi.fn(async (): Promise<ReadonlyArray<Diagnostic>> => []),
  setControls: vi.fn(),
  dispose: vi.fn(),
})

const makePanel = () => {
  const panel = document.createElement('div')
  panel.append(document.createElement('canvas'))
  return panel
}

const mountStream = (element: Element = makePanel()) =>
  MountGeneratedPreview({ source, startedAt }).f(
    element,
    Mount.liveViewStateChanges,
  )

test('the preview compiles with default controls and releases its renderer on unmount', async () => {
  const preview = makePreview()
  vi.mocked(createRenderer).mockResolvedValue(preview)
  const messages: Array<Message> = []
  const fiber = Effect.runFork(
    mountStream().pipe(
      Stream.runForEach(message => Effect.sync(() => messages.push(message))),
    ),
  )
  try {
    await vi.waitFor(() =>
      expect(messages).toEqual([
        Message.SucceededMountGeneratedPreview({ source }),
      ]),
    )
    expect(preview.render).toHaveBeenCalledWith(
      source,
      parseControls(source).controls,
      startedAt,
    )
    expect(preview.dispose).not.toHaveBeenCalled()
    expect(Anchor.anchorSetup).toHaveBeenCalledWith(expect.any(HTMLElement), {
      buttonId: 'ai-apply',
      anchor: { placement: 'top-end', gap: 8, padding: 12 },
      interceptTab: false,
    })
    expect(cleanupAnchor).not.toHaveBeenCalled()
  } finally {
    await Effect.runPromise(Fiber.interrupt(fiber))
  }
  expect(preview.dispose).toHaveBeenCalledOnce()
  expect(cleanupAnchor).toHaveBeenCalledOnce()
})

test('GPU failures remain scoped to the generated preview', async () => {
  const preview = makePreview()
  vi.mocked(createRenderer).mockResolvedValue(preview)
  const messages: Array<Message> = []
  const fiber = Effect.runFork(
    mountStream().pipe(
      Stream.take(2),
      Stream.runForEach(message => Effect.sync(() => messages.push(message))),
    ),
  )
  await vi.waitFor(() => expect(messages).toHaveLength(1))
  vi.mocked(createRenderer).mock.calls[0]?.[1]('Preview device lost')
  await Effect.runPromise(Fiber.join(fiber))
  expect(messages).toEqual([
    Message.SucceededMountGeneratedPreview({ source }),
    Message.FailedMountGeneratedPreview({
      source,
      reason: 'Preview device lost',
    }),
  ])
  expect(preview.dispose).toHaveBeenCalledOnce()
})

test('creation and compilation failures are reported without succeeding', async () => {
  vi.mocked(createRenderer).mockRejectedValueOnce(
    new Error('WebGPU unavailable'),
  )
  expect(
    await Effect.runPromise(
      mountStream().pipe(Stream.take(1), Stream.runCollect),
    ),
  ).toEqual([
    Message.FailedMountGeneratedPreview({
      source,
      reason: 'WebGPU unavailable',
    }),
  ])

  const preview = makePreview()
  preview.render.mockResolvedValueOnce([
    {
      id: 'syntax',
      line: 1,
      column: 1,
      severity: 'error',
      message: 'Invalid WGSL',
    },
  ])
  vi.mocked(createRenderer).mockResolvedValueOnce(preview)
  expect(
    await Effect.runPromise(
      mountStream().pipe(Stream.take(1), Stream.runCollect),
    ),
  ).toEqual([
    Message.FailedMountGeneratedPreview({ source, reason: 'Invalid WGSL' }),
  ])
  expect(preview.dispose).toHaveBeenCalledOnce()
})

test('an unavailable canvas is reported without allocating a renderer', async () => {
  expect(
    await Effect.runPromise(
      mountStream(document.createElement('div')).pipe(
        Stream.take(1),
        Stream.runCollect,
      ),
    ),
  ).toEqual([
    Message.FailedMountGeneratedPreview({
      source,
      reason: 'Preview canvas is unavailable.',
    }),
  ])
  expect(createRenderer).not.toHaveBeenCalled()
})

test('closing the hover during GPU startup releases resources acquired afterward', async () => {
  const preview = makePreview()
  let finishStartup: (renderer: Renderer) => void = () => undefined
  vi.mocked(createRenderer).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishStartup = resolve
      }),
  )
  const fiber = Effect.runFork(mountStream().pipe(Stream.runDrain))
  await vi.waitFor(() => expect(createRenderer).toHaveBeenCalledOnce())
  const unmounted = Effect.runPromise(Fiber.interrupt(fiber))
  finishStartup(preview)
  await unmounted
  expect(preview.render).not.toHaveBeenCalled()
  expect(preview.dispose).toHaveBeenCalledOnce()
  expect(cleanupAnchor).toHaveBeenCalledOnce()
})
