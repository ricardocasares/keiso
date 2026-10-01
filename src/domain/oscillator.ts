import { Match, Schema } from 'effect'

export const Waveform = Schema.Literals([
  'sine',
  'triangle',
  'sawtooth',
  'square',
])
export type Waveform = typeof Waveform.Type

export const OscillatorBinding = Schema.Struct({
  name: Schema.String,
  waveform: Waveform,
  period: Schema.Number,
  depth: Schema.Number,
  phase: Schema.Number,
  maybeColor: Schema.Option(Schema.Number),
})
export type OscillatorBinding = typeof OscillatorBinding.Type

export const oscillatorLevel = (
  binding: OscillatorBinding,
  elapsed: number,
): number => {
  const cycle = elapsed / binding.period + binding.phase / 360
  const position = cycle - Math.floor(cycle)
  return Match.value(binding.waveform).pipe(
    Match.when('sine', () => (1 - Math.cos(position * Math.PI * 2)) / 2),
    Match.when('triangle', () => 1 - Math.abs(position * 2 - 1)),
    Match.when('sawtooth', () => position),
    Match.when('square', () => (position < 0.5 ? 0 : 1)),
    Match.exhaustive,
  )
}
