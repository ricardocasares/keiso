import { Effect, Option, Redacted } from 'effect'
import { afterEach, expect, test, vi } from 'vitest'

import { generateShader } from './ai'
import type { Diagnostic } from './domain/shader'
import { renderer } from './host'
import { GenerateShader } from './main'
import { Message } from './message'

vi.mock('./ai', async importOriginal => ({
  ...(await importOriginal<typeof import('./ai')>()),
  generateShader: vi.fn(),
}))
vi.mock('./host', async importOriginal => ({
  ...(await importOriginal<typeof import('./host')>()),
  renderer: vi.fn(),
}))
afterEach(() => vi.resetAllMocks())

const source = 'fn fragment(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }'
const generate = () =>
  GenerateShader({
    prompt: 'Aurora',
    model: 'gemma4:31b-cloud',
    apiKey: Redacted.make(''),
    baseUrl: '',
    maybeSource: Option.none(),
  }).effect

const makeRenderer = () => ({
  validate: vi.fn(async (): Promise<ReadonlyArray<Diagnostic>> => []),
  render: vi.fn(async (): Promise<ReadonlyArray<Diagnostic>> => []),
  setControls: vi.fn(),
  dispose: vi.fn(),
})

test('AI source must compile before it is ready, while the live renderer stays untouched', async () => {
  const live = makeRenderer()
  vi.mocked(generateShader).mockReturnValue(Effect.succeed(source))
  vi.mocked(renderer).mockReturnValue(Effect.succeed(live))
  live.validate.mockResolvedValueOnce([
    {
      id: 'warning',
      line: 1,
      column: 1,
      severity: 'warning',
      message: 'Unused value',
    },
    {
      id: 'syntax',
      line: 2,
      column: 1,
      severity: 'error',
      message: 'Invalid WGSL',
    },
    {
      id: 'pipeline',
      line: 3,
      column: 1,
      severity: 'error',
      message: 'Missing fragment',
    },
  ])

  expect(await Effect.runPromise(generate())).toEqual(
    Message.FailedGenerateShader({ reason: 'Invalid WGSL\nMissing fragment' }),
  )
  expect(live.validate).toHaveBeenCalledWith(source)
  expect(live.render).not.toHaveBeenCalled()
  expect(live.setControls).not.toHaveBeenCalled()

  live.validate.mockResolvedValueOnce([
    {
      id: 'warning',
      line: 1,
      column: 1,
      severity: 'warning',
      message: 'Unused value',
    },
  ])
  expect(await Effect.runPromise(generate())).toEqual(
    Message.CompletedGenerateShader({ source }),
  )
})

test('GPU validation errors become retryable generation failures', async () => {
  const live = makeRenderer()
  vi.mocked(generateShader).mockReturnValue(Effect.succeed(source))
  vi.mocked(renderer).mockReturnValue(Effect.succeed(live))
  live.validate.mockRejectedValueOnce(new Error('GPU unavailable'))

  expect(await Effect.runPromise(generate())).toMatchObject({
    _tag: 'FailedGenerateShader',
    reason: expect.stringContaining('GPU unavailable'),
  })
  expect(live.render).not.toHaveBeenCalled()
})
