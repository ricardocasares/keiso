import { Effect, Option, Redacted } from 'effect'
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from 'effect/unstable/http'
import { expect, test } from 'vitest'

import { fetchAiModels, generateShader } from './ai'

const defaults = {
  prompt: 'Make colorful waves',
  model: 'gemma4:31b-cloud',
  apiKey: Redacted.make(''),
  baseUrl: '',
  maybeSource: Option.none<string>(),
}
const source = 'fn fragment(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }'

const makeClient = (respond = () => Response.json({ text: source })) => {
  const requests: Array<HttpClientRequest.HttpClientRequest> = []
  const client = HttpClient.make(request =>
    Effect.sync(() => {
      requests.push(request)
      return HttpClientResponse.fromWeb(request, respond())
    }),
  )
  return { client, requests }
}

const body = (request: HttpClientRequest.HttpClientRequest | undefined) => {
  if (request?.body._tag !== 'Uint8Array') {
    throw new Error('Expected a JSON request body')
  }
  return JSON.parse(new TextDecoder().decode(request.body.body))
}

test('generation sends the user request and defaults to the same-origin API', async () => {
  const { client, requests } = makeClient()
  const result = await generateShader(defaults).pipe(
    Effect.provideService(HttpClient.HttpClient, client),
    Effect.runPromise,
  )

  expect(result).toBe(source)
  expect(requests[0]?.url).toBe('/api/ai/generate')
  expect(requests[0]?.method).toBe('POST')
  expect(requests[0]?.headers['x-api-key']).toBeUndefined()
  expect(body(requests[0])).toEqual({
    model: 'gemma4:31b-cloud',
    prompt: 'Make colorful waves',
  })
  expect(body(requests[0]).prompt).not.toContain('Current shader to edit:')
})

test('connection overrides apply to both endpoints and keys stay out of payloads and URLs', async () => {
  const { client, requests } = makeClient(() =>
    Response.json({ text: source, models: ['first-model', 'second-model'] }),
  )
  const settings = {
    apiKey: Redacted.make('private-key'),
    baseUrl: 'https://provider.example/v1',
  }
  const results = await Effect.all([
    generateShader({
      ...defaults,
      ...settings,
      maybeSource: Option.some(source),
    }),
    fetchAiModels(settings),
  ]).pipe(
    Effect.provideService(HttpClient.HttpClient, client),
    Effect.runPromise,
  )

  expect(results).toEqual([source, ['first-model', 'second-model']])
  expect(body(requests[0])).toMatchObject({ baseUrl: settings.baseUrl })
  expect(body(requests[0]).prompt).toContain(
    `Current shader to edit:\n${source}`,
  )
  expect(JSON.stringify(body(requests[0]))).not.toContain('private-key')
  expect(requests[1]?.url).toBe('/api/ai/models')
  expect(requests[1]?.urlParams.params).toEqual([['baseUrl', settings.baseUrl]])
  requests.forEach(request => {
    expect(request.headers['x-api-key']).toBe('private-key')
    expect(JSON.stringify(request.headers)).not.toContain('private-key')
    expect(request.url).not.toContain('private-key')
  })
})

test('blank connection settings omit overrides for model listing', async () => {
  const { client, requests } = makeClient(() => Response.json({ models: [] }))
  await fetchAiModels({ apiKey: Redacted.make('  '), baseUrl: '  ' }).pipe(
    Effect.provideService(HttpClient.HttpClient, client),
    Effect.runPromise,
  )

  expect(requests[0]?.headers['x-api-key']).toBeUndefined()
  expect(requests[0]?.urlParams.params).toEqual([])
})

test('blank model uses the server default and a blank prompt never sends a request', async () => {
  const { client, requests } = makeClient()
  await generateShader({ ...defaults, model: '  ' }).pipe(
    Effect.provideService(HttpClient.HttpClient, client),
    Effect.runPromise,
  )
  expect(body(requests[0])).not.toHaveProperty('model')

  expect(
    await generateShader({ ...defaults, prompt: ' \n' }).pipe(
      Effect.flip,
      Effect.provideService(HttpClient.HttpClient, client),
      Effect.runPromise,
    ),
  ).toBe('Describe the shader you want to generate.')
  expect(requests).toHaveLength(1)
})

test.each([
  'bad URL',
  'https://user:secret@example.com/v1',
  'https://example.com?key=secret',
])('invalid endpoint %s fails before any network request', async baseUrl => {
  const { client, requests } = makeClient()
  const result = await fetchAiModels({ apiKey: defaults.apiKey, baseUrl }).pipe(
    Effect.flip,
    Effect.provideService(HttpClient.HttpClient, client),
    Effect.runPromise,
  )

  expect(result).toBe(
    'Enter an HTTP(S) endpoint without credentials, a query, or a fragment.',
  )
  expect(requests).toHaveLength(0)
})

test.each([
  source,
  `\n\n\`\`\`wgsl\n${source}\n\`\`\`\n`,
  `\`\`\`\n${source}\n\`\`\``,
])(
  'returns shader source with one optional surrounding fence removed',
  async text => {
    const { client } = makeClient(() => Response.json({ text }))
    expect(
      await generateShader(defaults).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.runPromise,
      ),
    ).toBe(source)
  },
)

test.each(['', ' \n', '```wgsl\n\n```'])(
  'rejects empty generation output',
  async text => {
    const { client } = makeClient(() => Response.json({ text }))
    expect(
      await generateShader(defaults).pipe(
        Effect.flip,
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.runPromise,
      ),
    ).toBe('The AI provider returned an empty shader. Try again.')
  },
)

test.each([
  {
    response: () => new Response('Not found', { status: 404 }),
    reason: 'Could not reach the AI API. Start the API server and try again.',
  },
  {
    response: () =>
      new Response('<html>UI only</html>', {
        headers: { 'content-type': 'text/html' },
      }),
    reason:
      'The AI API returned an invalid response. Ensure the API server is running.',
  },
  {
    response: () => Response.json({ text: 12 }),
    reason:
      'The AI API returned an invalid response. Ensure the API server is running.',
  },
  {
    response: () =>
      Response.json(
        { _tag: 'AiProviderError', message: 'private-provider-detail' },
        { status: 502 },
      ),
    reason:
      'AI provider request failed. Check the model, endpoint, and API key.',
  },
  {
    response: () =>
      Response.json(
        { _tag: 'AiTimeoutError', message: 'private-provider-detail' },
        { status: 504 },
      ),
    reason: 'AI request timed out. Try again or choose a faster model.',
  },
])(
  'API failure produces a safe reason: $reason',
  async ({ response, reason }) => {
    const { client } = makeClient(response)
    expect(
      await generateShader(defaults).pipe(
        Effect.flip,
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.runPromise,
      ),
    ).toBe(reason)
  },
)

test('transport failure produces a useful reason without leaking details', async () => {
  const client = HttpClient.make(request =>
    Effect.fail(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.TransportError({
          request,
          description: 'private-key',
        }),
      }),
    ),
  )
  expect(
    await fetchAiModels(defaults).pipe(
      Effect.flip,
      Effect.provideService(HttpClient.HttpClient, client),
      Effect.runPromise,
    ),
  ).toBe('Could not reach the AI API. Start the API server and try again.')
})
