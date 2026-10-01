import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { ShaderControl } from './shader'

export const Snapshot = Schema.Struct({
  source: Schema.String,
  controls: Schema.Array(ShaderControl),
  startedAt: Schema.Number.check(Schema.isFinite()),
  revision: Schema.Natural,
})
export type Snapshot = typeof Snapshot.Type

export const Broadcast = defineTaggedUnion({
  Hello: {},
  State: { snapshot: Snapshot },
  Status: { reason: Schema.String },
})
export type Broadcast = typeof Broadcast.Type
