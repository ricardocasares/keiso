import { Cause, Effect, Match, Option, Redacted, Schema } from 'effect'
import { HttpClient, HttpClientError } from 'effect/unstable/http'
import { HttpApiClient } from 'effect/unstable/httpapi'

import { AiBaseUrl, AiProviderError, AiTimeoutError, Api } from './api/contract'

type AiConnection = {
  readonly apiKey: Redacted.Redacted<string>
  readonly baseUrl: string
}

const apiErrorReason = (error: unknown): string =>
  Match.value(error).pipe(
    Match.when(
      (error: unknown) =>
        Cause.isTimeoutError(error) || Schema.is(AiTimeoutError)(error),
      () => 'AI request timed out. Try again or choose a faster model.',
    ),
    Match.when(
      Schema.is(AiProviderError),
      () =>
        'AI provider request failed. Check the model, endpoint, and API key.',
    ),
    Match.when(HttpClientError.isHttpClientError, error =>
      Match.value(error.reason).pipe(
        Match.when(
          { _tag: 'TransportError' },
          () =>
            'Could not reach the AI API. Start the API server and try again.',
        ),
        Match.when({ _tag: 'StatusCodeError' }, error =>
          error.response.status === 400
            ? 'The AI request was rejected. Check the prompt, model, endpoint, and API key.'
            : 'Could not reach the AI API. Start the API server and try again.',
        ),
        Match.when({ _tag: 'DecodeError' }, error =>
          error.response.status >= 400
            ? 'Could not reach the AI API. Start the API server and try again.'
            : 'The AI API returned an invalid response. Ensure the API server is running.',
        ),
        Match.orElse(
          () =>
            'The AI API returned an invalid response. Ensure the API server is running.',
        ),
      ),
    ),
    Match.orElse(
      () =>
        'The AI API returned an invalid response. Ensure the API server is running.',
    ),
  )

const connection = ({ apiKey, baseUrl }: AiConnection) =>
  Effect.gen(function* () {
    const endpoint = baseUrl.trim()
    const url =
      endpoint === ''
        ? undefined
        : yield* Schema.decodeUnknownEffect(AiBaseUrl)(endpoint).pipe(
            Effect.mapError(
              () =>
                'Enter an HTTP(S) endpoint without credentials, a query, or a fragment.',
            ),
          )
    const key = Redacted.value(apiKey).trim()
    const httpClient = yield* HttpClient.HttpClient
    const client = yield* HttpApiClient.group(Api, { group: 'ai', httpClient })
    return {
      client,
      query: url === undefined ? {} : { baseUrl: url },
      headers: key === '' ? {} : { 'x-api-key': Redacted.make(key) },
    }
  })

export const fetchAiModels = (settings: AiConnection) =>
  Effect.gen(function* () {
    const request = yield* connection(settings)
    const response = yield* request.client
      .models({
        headers: request.headers,
        query: request.query,
      })
      .pipe(Effect.timeout('15 seconds'), Effect.mapError(apiErrorReason))
    return response.models
  })

export const generateShader = (
  settings: AiConnection & {
    readonly prompt: string
    readonly model: string
    readonly maybeSource: Option.Option<string>
  },
) =>
  Effect.gen(function* () {
    if (settings.prompt.trim() === '') {
      return yield* Effect.fail('Describe the shader you want to generate.')
    }
    const request = yield* connection(settings)
    const context = Option.match(settings.maybeSource, {
      onNone: () => '',
      onSome: source => `\n\nCurrent shader to edit:\n${source}`,
    })
    const model = settings.model.trim()
    const response = yield* request.client
      .generate({
        headers: request.headers,
        payload: {
          prompt: `${settings.prompt}${context}`,
          ...request.query,
          ...(model === '' ? {} : { model }),
        },
      })
      .pipe(Effect.timeout('130 seconds'), Effect.mapError(apiErrorReason))
    const text = response.text.trim()
    const fence = text.match(/^```(?:wgsl)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/i)
    const source = (fence?.[1] ?? text).trim()
    return source === ''
      ? yield* Effect.fail(
          'The AI provider returned an empty shader. Try again.',
        )
      : source
  })
