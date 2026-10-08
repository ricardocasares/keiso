import { Layer } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BunHttpServer } from '@effect/platform-bun'

import { Api } from './contract.ts'
import { SystemApiHandlers } from './handlers.ts'

const ApiRoutes = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(SystemApiHandlers),
)

const HttpServerLayer = HttpRouter.serve(ApiRoutes).pipe(
  Layer.provide(BunHttpServer.layer({ port: 3000 })),
)

export const main = Layer.launch(HttpServerLayer)
