import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { Api } from './contract.ts'

export const SystemApiHandlers = HttpApiBuilder.group(Api, 'system', handlers =>
  handlers.handleAll({
    health: () => Effect.void,
  }),
)
