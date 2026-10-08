import { Redacted, Schema, SchemaGetter } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { HoverIntent, Listbox, RadioGroup } from '@foldkit/ui'

import { MidiBinding, MidiInput } from './domain/midi'
import { OscillatorBinding } from './domain/oscillator'
import { Snapshot } from './domain/session'
import { Diagnostic } from './domain/shader'

export const EngineState = defineTaggedUnion({
  Starting: {},
  Ready: {},
  Failed: { reason: Schema.String },
})
// Foldkit serializes the model for development reloads; credentials must stay in memory.
export const AiApiKey = Schema.Redacted(Schema.String).annotate({
  toCodecJson: () =>
    Schema.link<Redacted.Redacted<string>>()(Schema.String, {
      decode: SchemaGetter.succeed(Redacted.make('')),
      encode: SchemaGetter.succeed(''),
    }),
})
export const AiModelsState = defineTaggedUnion({
  Idle: {},
  Loading: {},
  Ready: { models: Schema.Array(Schema.String) },
  Failed: { reason: Schema.String },
})
export const GenerationState = defineTaggedUnion({
  Idle: {},
  Generating: {},
  Ready: { source: Schema.String, preview: EngineState },
  Failed: { reason: Schema.String },
})
export const Validation = defineTaggedUnion({
  Checking: {},
  Checked: { diagnostics: Schema.Array(Diagnostic) },
})
export const RenderState = defineTaggedUnion({
  Idle: {},
  Compiling: { draftGeneration: Schema.Natural },
})
export const MicrophoneState = defineTaggedUnion({
  Idle: {},
  Starting: {},
  Ready: {},
  Failed: { reason: Schema.String },
})
export const MidiState = defineTaggedUnion({
  Idle: {},
  Starting: {},
  Ready: { inputs: Schema.Array(MidiInput) },
  Failed: { reason: Schema.String },
})
export const MicrophoneBinding = Schema.Struct({
  name: Schema.String,
  bands: Schema.Array(Schema.Natural),
  gain: Schema.Number,
  maybeColor: Schema.Option(Schema.Number),
})
export type MicrophoneBinding = typeof MicrophoneBinding.Type
export { OscillatorBinding } from './domain/oscillator'
export const SpectrumDrag = defineTaggedUnion({
  Idle: {},
  Dragging: {
    name: Schema.String,
    lastIndex: Schema.Natural,
    selection: Schema.Literals(['add', 'remove']),
  },
})
export const Flags = Schema.Struct({
  mode: Schema.Literals(['control', 'projection']),
  sessionId: Schema.String,
  startedAt: Schema.Number,
})
export type Flags = typeof Flags.Type
export const Model = Schema.Struct({
  mode: Flags.fields.mode,
  sessionId: Schema.String,
  startedAt: Schema.Number,
  source: Schema.String,
  draftGeneration: Schema.Natural,
  liveGeneration: Schema.Natural,
  exampleId: Schema.String,
  exampleListbox: Listbox.Model,
  aiPrompt: Schema.String,
  aiModel: Schema.String,
  aiApiKey: AiApiKey,
  aiBaseUrl: Schema.String,
  aiModels: AiModelsState,
  includesEditorCode: Schema.Boolean,
  isAiSettingsOpen: Schema.Boolean,
  generation: GenerationState,
  aiPreview: HoverIntent.Model,
  engine: EngineState,
  validation: Validation,
  render: RenderState,
  maybeLive: Schema.Option(Snapshot),
  maybeIncoming: Schema.Option(Snapshot),
  maybeNotice: Schema.Option(Schema.String),
  projectionStatus: Schema.String,
  isHelpOpen: Schema.Boolean,
  microphone: MicrophoneState,
  microphoneSession: Schema.Natural,
  microphoneBindings: Schema.Array(MicrophoneBinding),
  oscillatorBindings: Schema.Array(OscillatorBinding),
  midi: MidiState,
  midiSession: Schema.Natural,
  midiBindings: Schema.Array(MidiBinding),
  maybeMidiLearning: Schema.Option(Schema.String),
  waveformRadioGroup: RadioGroup.Model,
  maybeOscillatorPeriodEdit: Schema.Option(
    Schema.Struct({ name: Schema.String, value: Schema.String }),
  ),
  maybeSelectedControl: Schema.Option(Schema.String),
  spectrum: Schema.Array(Schema.Number),
  spectrumDrag: SpectrumDrag,
})
export type Model = typeof Model.Type
