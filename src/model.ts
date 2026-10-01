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
export const RenderState = defineTaggedUnion({ Idle: {}, Compiling: {} })
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
})
export type Model = typeof Model.Type
