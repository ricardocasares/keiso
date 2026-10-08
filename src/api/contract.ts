import { Schema } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/unstable/httpapi'

const NonBlankString = Schema.String.check(Schema.isPattern(/\S/))

export const AiBaseUrl = Schema.URLFromString.check(
  Schema.makeFilter(
    url =>
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === '' &&
      !url.href.includes('?') &&
      !url.href.includes('#'),
    {
      message:
        'Expected an HTTP(S) base URL without credentials, query, or fragment',
    },
  ),
)

export class AiProviderError extends Schema.Error<AiProviderError>(
  'AiProviderError',
)(
  { _tag: Schema.tag('AiProviderError'), message: Schema.String },
  { httpApiStatus: 502 },
) {}

export class AiTimeoutError extends Schema.Error<AiTimeoutError>(
  'AiTimeoutError',
)(
  { _tag: Schema.tag('AiTimeoutError'), message: Schema.String },
  { httpApiStatus: 504 },
) {}

const AiHeaders = {
  'x-api-key': Schema.optional(Schema.Redacted(Schema.String)),
}

const AiApi = HttpApiGroup.make('ai').add(
  HttpApiEndpoint.post('generate', '/ai/generate', {
    headers: AiHeaders,
    payload: Schema.Struct({
      prompt: NonBlankString,
      model: Schema.optional(NonBlankString),
      baseUrl: Schema.optional(AiBaseUrl),
    }),
    success: Schema.Struct({ text: Schema.String }),
    error: [AiProviderError, AiTimeoutError],
  }),
  HttpApiEndpoint.get('models', '/ai/models', {
    headers: AiHeaders,
    query: { baseUrl: Schema.optional(AiBaseUrl) },
    success: Schema.Struct({ models: Schema.Array(Schema.String) }),
    error: [AiProviderError, AiTimeoutError],
  }),
)

const SystemApi = HttpApiGroup.make('system', { topLevel: true }).add(
  HttpApiEndpoint.get('health', '/health', {
    success: HttpApiSchema.NoContent,
  }),
)

export class Api extends HttpApi.make('keiso-api')
  .add(SystemApi, AiApi)
  .prefix('/api') {}
