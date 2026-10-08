import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/unstable/httpapi'

const SystemApi = HttpApiGroup.make('system', { topLevel: true }).add(
  HttpApiEndpoint.get('health', '/health', {
    success: HttpApiSchema.NoContent,
  }),
)

export class Api extends HttpApi.make('keiso-api')
  .add(SystemApi)
  .prefix('/api') {}
