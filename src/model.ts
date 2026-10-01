import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { Listbox } from '@foldkit/ui'

import { Snapshot } from './domain/session'
import { Diagnostic } from './domain/shader'

export const EngineState = defineTaggedUnion({
  Starting: {},
  Ready: {},
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
export const MicrophoneBinding = Schema.Struct({
  name: Schema.String,
  bands: Schema.Array(Schema.Natural),
  gain: Schema.Number,
  maybeColor: Schema.Option(Schema.Number),
})
export type MicrophoneBinding = typeof MicrophoneBinding.Type
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
  maybeSelectedControl: Schema.Option(Schema.String),
  spectrum: Schema.Array(Schema.Number),
  spectrumDrag: SpectrumDrag,
})
export type Model = typeof Model.Type
