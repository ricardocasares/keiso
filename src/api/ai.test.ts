// @vitest-environment node
import { ConfigProvider, Effect, Layer } from 'effect'
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
} from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { expect, onTestFinished, test } from 'vitest'

import { Api } from './contract.ts'
import { AiApiHandlers, SystemApiHandlers } from './handlers.ts'

const completion = {
  id: 'completion-1',
  created: 0,
  model: 'provider-model',
  choices: [
    { index: 0, finish_reason: 'stop', message: { content: 'Generated text' } },
  ],
}

const makeApi = (
  env: Record<string, string> = {},
  respond = () => Response.json(completion),
) => {
  const requests: Array<Request> = []
  const httpClient = HttpClient.make(request =>
    Effect.gen(function* () {
      requests.push(yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie))
      return HttpClientResponse.fromWeb(request, respond())
    }),
  )
  const { handler, dispose } = HttpRouter.toWebHandler(
    HttpApiBuilder.layer(Api).pipe(
      Layer.provide([AiApiHandlers, SystemApiHandlers]),
      Layer.provide(HttpServer.layerServices),
      Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient)),
      Layer.provide(
        Layer.succeed(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({ env }),
        ),
      ),
    ),
    { disableLogger: true },
  )
  onTestFinished(dispose)
  return { handler, requests }
}

const generateRequest = (payload: unknown, apiKey?: string) =>
  new Request('http://localhost/api/ai/generate', {
    method: 'POST',
    headers:
      apiKey === undefined
        ? { 'content-type': 'application/json' }
        : { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(payload),
  })

const modelsRequest = (baseUrl?: string, apiKey?: string) =>
  new Request(
    `http://localhost/api/ai/models${baseUrl === undefined ? '' : `?${new URLSearchParams({ baseUrl })}`}`,
    { headers: apiKey === undefined ? {} : { 'x-api-key': apiKey } },
  )

test.each([
  {
    env: {},
    url: 'https://ollama.com/v1/chat/completions',
    authorization: null,
    model: 'gemma4:31b',
  },
  {
    env: { OPENAI_API_KEY: 'server-key' },
    url: 'https://ollama.com/v1/chat/completions',
    authorization: 'Bearer server-key',
    model: 'gemma4:31b',
  },
  {
    env: {
      OPENAI_BASE_URL: 'http://localhost:11434/v1/',
      OPENAI_API_KEY: 'server-key',
    },
    url: 'http://localhost:11434/v1/chat/completions',
    authorization: 'Bearer server-key',
    model: 'gemma4:31b-cloud',
  },
])('generate uses configured defaults at $url', async settings => {
  const { handler, requests } = makeApi(settings.env)
  const response = await handler(generateRequest({ prompt: 'Write a shader' }))

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ text: 'Generated text' })
  expect(requests).toHaveLength(1)
  expect(requests[0]?.url).toBe(settings.url)
  expect(requests[0]?.headers.get('authorization')).toBe(settings.authorization)
  expect(await requests[0]?.json()).toMatchObject({
    model: settings.model,
    messages: [
      {
        role: 'system',
        content: expect.stringContaining('Return only raw WGSL source.'),
      },
      { role: 'user', content: 'Write a shader' },
    ],
  })
})

test('concurrent generation overrides stay isolated from each other and defaults', async () => {
  const { handler, requests } = makeApi({ OPENAI_API_KEY: 'server-key' })
  const responses = await Promise.all([
    handler(
      generateRequest(
        {
          prompt: 'First prompt',
          model: 'first-model',
          baseUrl: 'https://first.example/v1/',
        },
        'first-key',
      ),
    ),
    handler(
      generateRequest(
        {
          prompt: 'Second prompt',
          model: 'second-model',
          baseUrl: 'https://second.example/v1',
        },
        'second-key',
      ),
    ),
    handler(generateRequest({ prompt: 'Default prompt' })),
  ])

  expect(responses.map(response => response.status)).toEqual([200, 200, 200])
  expect(
    await Promise.all(
      requests.map(async request => ({
        url: request.url,
        authorization: request.headers.get('authorization'),
        body: await request.json(),
      })),
    ),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        url: 'https://first.example/v1/chat/completions',
        authorization: 'Bearer first-key',
        body: expect.objectContaining({ model: 'first-model' }),
      }),
      expect.objectContaining({
        url: 'https://second.example/v1/chat/completions',
        authorization: 'Bearer second-key',
        body: expect.objectContaining({ model: 'second-model' }),
      }),
      expect.objectContaining({
        url: 'https://ollama.com/v1/chat/completions',
        authorization: 'Bearer server-key',
        body: expect.objectContaining({ model: 'gemma4:31b' }),
      }),
    ]),
  )
})

test('models returns model IDs and supports provider and API key overrides', async () => {
  const { handler, requests } = makeApi({ OPENAI_API_KEY: 'server-key' }, () =>
    Response.json({
      data: [{ id: 'gemma4:31b', object: 'model' }, { id: 'other' }],
    }),
  )
  const response = await handler(
    modelsRequest('http://localhost:11434/v1/', 'request-key'),
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ models: ['gemma4:31b', 'other'] })
  expect(requests).toHaveLength(1)
  expect(requests[0]?.url).toBe('http://localhost:11434/v1/models')
  expect(requests[0]?.method).toBe('GET')
  expect(requests[0]?.headers.get('authorization')).toBe('Bearer request-key')
})

test.each([
  [undefined, 'Bearer server-key'],
  ['https://OLLAMA.com:443/v1/', 'Bearer server-key'],
  ['https://ollama.com/other', null],
  ['https://other.example/v1', null],
])(
  'models only sends the saved key to its configured base URL: %s',
  async (baseUrl, authorization) => {
    const { handler, requests } = makeApi(
      { OPENAI_API_KEY: 'server-key' },
      () => Response.json({ data: [] }),
    )
    const response = await handler(modelsRequest(baseUrl))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ models: [] })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.headers.get('authorization')).toBe(authorization)
  },
)

test.each([
  {},
  { prompt: '' },
  { prompt: '  \n' },
  { prompt: 12 },
  { prompt: 'Hi', model: '' },
])(
  'rejects invalid generation payload %j before calling the provider',
  async payload => {
    const { handler, requests } = makeApi()
    const response = await handler(generateRequest(payload))

    expect(response.status).toBe(400)
    expect(requests).toHaveLength(0)
  },
)

test.each([
  'not-a-url',
  'file:///etc/passwd',
  'https://user:secret@example.com/v1',
  'https://example.com/v1?key=secret',
  'https://example.com/v1#fragment',
  'https://example.com/v1?',
  'https://example.com/v1#',
])('both endpoints reject invalid base URL %s', async baseUrl => {
  const { handler, requests } = makeApi()
  const responses = await Promise.all([
    handler(generateRequest({ prompt: 'Hi', baseUrl })),
    handler(modelsRequest(baseUrl)),
  ])

  expect(responses.map(response => response.status)).toEqual([400, 400])
  expect(requests).toHaveLength(0)
})

test.each([401, 500])(
  'both endpoints sanitize provider HTTP %i errors',
  async status => {
    const { handler } = makeApi({ OPENAI_API_KEY: 'server-key' }, () =>
      Response.json(
        { error: { message: 'Private upstream detail: server-key' } },
        { status },
      ),
    )
    const responses = await Promise.all([
      handler(generateRequest({ prompt: 'Private prompt' })),
      handler(modelsRequest()),
    ])

    expect(responses.map(response => response.status)).toEqual([502, 502])
    const expected = {
      _tag: 'AiProviderError',
      message:
        'AI provider request failed. Check the model, base URL, and API key.',
    }
    expect(
      await Promise.all(responses.map(response => response.json())),
    ).toEqual([expected, expected])
  },
)

test.each([{ data: [{ id: 12 }] }, { models: [] }])(
  'models rejects malformed provider responses %j',
  async body => {
    const { handler } = makeApi({}, () => Response.json(body))
    const response = await handler(modelsRequest())

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ _tag: 'AiProviderError' })
  },
)
