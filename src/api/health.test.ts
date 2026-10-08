import { Effect } from 'effect'
import { HttpServer } from 'effect/unstable/http'
import { HttpApiTest } from 'effect/unstable/httpapi'
import { expect, test } from 'vitest'

import { Api } from './contract.ts'
import { SystemApiHandlers } from './handlers.ts'

test('GET /api/health returns 204 with an empty body', () =>
  Effect.gen(function* () {
    const client = yield* HttpApiTest.groups(Api, ['system'])
    const response = yield* client.health({ responseMode: 'response-only' })

    expect(response.request.method).toBe('GET')
    expect(new URL(response.request.url).pathname).toBe('/api/health')
    expect(response.status).toBe(204)
    expect(yield* response.text).toBe('')
  }).pipe(
    Effect.provide([SystemApiHandlers, HttpServer.layerServices]),
    Effect.scoped,
    Effect.runPromise,
  ))
