import { Layer } from 'effect'
import { FetchHttpClient, HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BunHttpServer } from '@effect/platform-bun'

import { Api } from './contract.ts'
import { AiApiHandlers, SystemApiHandlers } from './handlers.ts'

const ApiRoutes = HttpApiBuilder.layer(Api).pipe(
  Layer.provide([SystemApiHandlers, AiApiHandlers]),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(
    Layer.succeed(FetchHttpClient.RequestInit, { redirect: 'error' }),
  ),
)

const HttpServerLayer = HttpRouter.serve(ApiRoutes).pipe(
  Layer.provide(
    BunHttpServer.layer({
      // shortcut: trusted local callers only, add authentication before remote hosting.
      hostname: '127.0.0.1',
      port: 3000,
      idleTimeout: 180,
    }),
  ),
)

export const main = Layer.launch(HttpServerLayer)
