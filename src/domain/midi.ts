import { Schema } from 'effect'

export const MidiInput = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})
export type MidiInput = typeof MidiInput.Type

export const MidiSource = Schema.Struct({
  inputId: Schema.String,
  inputName: Schema.String,
  kind: Schema.Literals(['cc', 'note']),
  channel: Schema.Natural.check(Schema.isBetween({ minimum: 1, maximum: 16 })),
  number: Schema.Natural.check(Schema.isBetween({ minimum: 0, maximum: 127 })),
})
export type MidiSource = typeof MidiSource.Type

export const MidiSignal = Schema.Struct({
  source: MidiSource,
  value: Schema.Natural.check(Schema.isBetween({ minimum: 0, maximum: 127 })),
})
export type MidiSignal = typeof MidiSignal.Type

export const MidiBinding = Schema.Struct({
  name: Schema.String,
  maybeSource: Schema.Option(MidiSource),
  maybePendingValue: Schema.Option(MidiSignal.fields.value),
  maybeColor: Schema.Option(Schema.Number),
})
export type MidiBinding = typeof MidiBinding.Type

export const midiSourceLabel = (source: MidiSource): string =>
  `${source.inputName} · Ch ${source.channel} · ${source.kind === 'cc' ? 'CC' : 'Note'} ${source.number}`

export const matchesMidiSource = (
  first: MidiSource,
  second: MidiSource,
): boolean =>
  first.inputId === second.inputId &&
  first.channel === second.channel &&
  first.kind === second.kind &&
  first.number === second.number
