import { Array, Cause, Effect, Queue, Stream } from 'effect'

import { Message } from './message'

export const spectrumBands: ReadonlyArray<{ low: number; high: number }> =
  Array.makeBy(64, index => ({
    low: 20 * 1000 ** (index / 64),
    high: 20 * 1000 ** ((index + 1) / 64),
  }))

export const bandsInRange = (
  low: number,
  high: number,
): ReadonlyArray<number> =>
  !Number.isFinite(low) || !Number.isFinite(high) || low >= high
    ? []
    : spectrumBands.flatMap((band, index) =>
        band.high > low && band.low < high ? [index] : [],
      )

export const bandLevel = (
  spectrum: ReadonlyArray<number>,
  bands: ReadonlyArray<number>,
  gain: number,
): number => {
  if (!Number.isFinite(gain) || gain < 0) {
    return 0
  }
  const selected = new Set(bands)
  const band = spectrumBands.reduce(
    (total, band, index) => {
      const weight = selected.has(index) ? band.high - band.low : 0
      const value = spectrum[index] ?? 0
      const level = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
      return {
        energy: total.energy + level ** 2 * weight,
        weight: total.weight + weight,
      }
    },
    { energy: 0, weight: 0 },
  )
  return band.weight === 0
    ? 0
    : Math.min(1, Math.sqrt(band.energy / band.weight) * gain)
}

const microphoneReason = (error: unknown): string => {
  if (error instanceof Error && error.name === 'NotAllowedError') {
    return 'Microphone access was denied. Allow access in your browser and try again.'
  }
  if (error instanceof Error && error.name === 'NotFoundError') {
    return 'No microphone was found. Connect a microphone and try again.'
  }
  return error instanceof Error ? error.message : String(error)
}

const stopTracks = (stream: MediaStream) =>
  stream.getTracks().forEach(track => track.stop())

export const streamMicrophone = (sessionId: number) =>
  Stream.callback<
    | typeof Message.SucceededStartMicrophone.Type
    | typeof Message.UpdatedMicrophoneSpectrum.Type,
    string
  >(queue =>
    Effect.gen(function* () {
      const context = yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            if (
              !navigator.mediaDevices?.getUserMedia ||
              typeof AudioContext === 'undefined' ||
              typeof AudioWorkletNode === 'undefined'
            ) {
              throw new Error(
                'Microphone input requires a supported browser on HTTPS or localhost.',
              )
            }
            return new AudioContext()
          },
          catch: microphoneReason,
        }),
        value =>
          Effect.tryPromise(() => value.close()).pipe(
            Effect.catch(() => Effect.void),
          ),
      )
      const microphone = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: signal =>
            navigator.mediaDevices
              .getUserMedia({
                audio: {
                  echoCancellation: false,
                  noiseSuppression: false,
                  autoGainControl: false,
                },
              })
              .then(stream => {
                signal.addEventListener('abort', () => stopTracks(stream), {
                  once: true,
                })
                if (signal.aborted) {
                  stopTracks(stream)
                }
                return stream
              }),
          catch: microphoneReason,
        }),
        stream => Effect.sync(() => stopTracks(stream)),
        { interruptible: true },
      )
      yield* Effect.tryPromise({
        try: () => context.resume(),
        catch: microphoneReason,
      }).pipe(
        Effect.timeout('3 seconds'),
        Effect.catchTag('TimeoutError', () =>
          Effect.fail(
            'Audio could not start. Enable the microphone again to retry.',
          ),
        ),
      )
      yield* Effect.tryPromise({
        try: () =>
          context.audioWorklet.addModule(
            new URL('./microphone-clock.js', import.meta.url).href,
          ),
        catch: microphoneReason,
      })
      const analyser = yield* Effect.acquireRelease(
        Effect.try(() => {
          const analyser = context.createAnalyser()
          analyser.fftSize = 8192
          analyser.smoothingTimeConstant = 0.75
          return analyser
        }).pipe(Effect.mapError(microphoneReason)),
        value => Effect.sync(() => value.disconnect()),
      )
      const source = yield* Effect.acquireRelease(
        Effect.try(() => context.createMediaStreamSource(microphone)).pipe(
          Effect.mapError(microphoneReason),
        ),
        value => Effect.sync(() => value.disconnect()),
      )
      const clock = yield* Effect.acquireRelease(
        Effect.try(
          () =>
            new AudioWorkletNode(context, 'microphone-clock', {
              outputChannelCount: [1],
            }),
        ).pipe(Effect.mapError(microphoneReason)),
        value =>
          Effect.sync(() => {
            value.port.onmessage = null
            value.onprocessorerror = null
            value.port.close()
            value.disconnect()
          }),
      )
      const frequencies = new Uint8Array(analyser.frequencyBinCount)
      const ranges = spectrumBands.map(band => ({
        start: Math.min(
          frequencies.length,
          Math.floor((band.low * analyser.fftSize) / context.sampleRate),
        ),
        end: Math.min(
          frequencies.length,
          Math.ceil((band.high * analyser.fftSize) / context.sampleRate),
        ),
      }))
      const fail = (reason: string) =>
        Queue.failCauseUnsafe(queue, Cause.fail(reason))
      const checkInput = () => {
        if (
          !microphone
            .getAudioTracks()
            .some(track => track.readyState === 'live')
        ) {
          throw new Error(
            'The microphone disconnected or access was revoked. Enable it again to retry.',
          )
        }
        if (context.state !== 'running') {
          throw new Error(
            'Microphone audio was interrupted. Enable it again to retry.',
          )
        }
      }
      const checkState = () => {
        try {
          checkInput()
        } catch (error) {
          fail(microphoneReason(error))
        }
      }
      clock.port.onmessage = () => {
        try {
          checkInput()
          analyser.getByteFrequencyData(frequencies)
          const spectrum = ranges.map(({ start, end }) =>
            end <= start
              ? 0
              : Math.sqrt(
                  frequencies
                    .subarray(start, end)
                    .reduce((sum, value) => sum + (value / 255) ** 2, 0) /
                    (end - start),
                ),
          )
          Queue.offerUnsafe(
            queue,
            Message.UpdatedMicrophoneSpectrum({ sessionId, spectrum }),
          )
        } catch (error) {
          fail(microphoneReason(error))
        }
      }
      clock.onprocessorerror = () =>
        fail(
          'Microphone processing stopped. Enable the microphone again to retry.',
        )
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          context.addEventListener('statechange', checkState)
          microphone
            .getAudioTracks()
            .forEach(track => track.addEventListener('ended', checkState))
        }),
        () =>
          Effect.sync(() => {
            context.removeEventListener('statechange', checkState)
            microphone
              .getAudioTracks()
              .forEach(track => track.removeEventListener('ended', checkState))
          }),
      )
      yield* Effect.try({
        try: () => {
          checkInput()
          source.connect(analyser)
          analyser.connect(clock)
          clock.connect(context.destination)
        },
        catch: microphoneReason,
      })
      Queue.offerUnsafe(queue, Message.SucceededStartMicrophone({ sessionId }))
      return yield* Effect.never
    }).pipe(Effect.catch(reason => Queue.fail(queue, reason))),
  ).pipe(
    Stream.catch(reason =>
      Stream.make(Message.FailedMicrophone({ sessionId, reason })),
    ),
  )
