import { Config, Effect, Option, Redacted, Schema } from 'effect'
import { LanguageModel } from 'effect/unstable/ai'
import { HttpClient, HttpClientResponse } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai-compat'

import { AiBaseUrl, AiProviderError, AiTimeoutError, Api } from './contract.ts'
import { shaderSystemPrompt } from './shader-prompt.ts'

const ollamaBaseUrl = 'https://ollama.com/v1'
const defaultModel = 'gemma4:31b-cloud'
const normalizeBaseUrl = (value: URL) => value.href.replace(/\/+$/, '')
const ModelsResponse = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: Schema.String })),
})

const providerRequest = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError(
      () =>
        new AiProviderError({
          message:
            'AI provider request failed. Check the model, base URL, and API key.',
        }),
    ),
    Effect.timeoutOrElse({
      duration: '2 minutes',
      orElse: () =>
        Effect.fail(
          new AiTimeoutError({ message: 'AI provider request timed out.' }),
        ),
    }),
  )

export const AiApiHandlers = HttpApiBuilder.group(Api, 'ai', handlers =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient
    const baseUrl = normalizeBaseUrl(
      yield* Config.schema(AiBaseUrl, 'OPENAI_BASE_URL').pipe(
        Config.withDefault(new URL(ollamaBaseUrl)),
      ),
    )
    const maybeApiKey = yield* Config.option(Config.Redacted('OPENAI_API_KEY'))
    const makeClient = (
      requestBaseUrl: URL | undefined,
      apiKey: Redacted.Redacted<string> | undefined,
    ) => {
      const apiUrl =
        requestBaseUrl === undefined
          ? baseUrl
          : normalizeBaseUrl(requestBaseUrl)
      return OpenAiClient.make({
        apiUrl,
        apiKey:
          apiKey ??
          (apiUrl === baseUrl ? Option.getOrUndefined(maybeApiKey) : undefined),
      }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient))
    }

    return handlers.handleAll({
      generate: ({ payload, headers }) =>
        Effect.gen(function* () {
          const client = yield* makeClient(
            payload.baseUrl,
            headers['x-api-key'],
          )
          const apiUrl =
            payload.baseUrl === undefined
              ? baseUrl
              : normalizeBaseUrl(payload.baseUrl)
          const requestedModel = payload.model ?? defaultModel
          const model =
            apiUrl === ollamaBaseUrl && requestedModel === defaultModel
              ? 'gemma4:31b'
              : requestedModel
          const response = yield* LanguageModel.generateText({
            prompt: [
              { role: 'system', content: shaderSystemPrompt },
              { role: 'user', content: payload.prompt },
            ],
          }).pipe(
            Effect.provide(OpenAiLanguageModel.layer({ model })),
            Effect.provideService(OpenAiClient.OpenAiClient, client),
          )
          return { text: response.text }
        }).pipe(providerRequest),
      models: ({ query, headers }) =>
        Effect.gen(function* () {
          const client = yield* makeClient(query.baseUrl, headers['x-api-key'])
          const response = yield* HttpClient.filterStatusOk(client.client).get(
            '/models',
          )
          const body =
            yield* HttpClientResponse.schemaBodyJson(ModelsResponse)(response)
          return { models: body.data.map(model => model.id) }
        }).pipe(providerRequest),
    })
  }),
)

export const SystemApiHandlers = HttpApiBuilder.group(Api, 'system', handlers =>
  handlers.handleAll({
    health: () => Effect.void,
  }),
)
