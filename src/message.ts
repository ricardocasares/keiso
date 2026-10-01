import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { Broadcast, Snapshot } from './domain/session'
import { Diagnostic } from './domain/shader'

export const Message = defineMessageUnion({
  SucceededMountRenderer: {},
  FailedMountRenderer: { reason: Schema.String },
  FailedRenderer: { reason: Schema.String },
  SucceededMountEditor: {},
  FailedMountEditor: { reason: Schema.String },
  SucceededMountChannel: {},
  FailedMountChannel: { reason: Schema.String },
  UpdatedSource: { source: Schema.String },
  SelectedExample: { id: Schema.String },
  PressedRender: {},
  CompletedValidateShader: {
    source: Schema.String,
    diagnostics: Schema.Array(Diagnostic),
  },
  CompletedRenderShader: {
    snapshot: Snapshot,
    diagnostics: Schema.Array(Diagnostic),
  },
  UpdatedControl: { name: Schema.String, value: Schema.Number },
  ReceivedBroadcast: { broadcast: Broadcast },
  CompletedSyncControls: {},
  FailedSyncControls: { reason: Schema.String },
  CompletedUpdateEditor: {},
  CompletedShowDiagnostics: {},
  FailedUpdateEditor: { reason: Schema.String },
  CompletedBroadcastState: {},
  FailedBroadcastState: { reason: Schema.String },
  ClickedProjection: {},
  CompletedOpenProjection: {},
  FailedOpenProjection: { reason: Schema.String },
  ClickedDiagnostic: { line: Schema.Number, column: Schema.Number },
  CompletedFocusDiagnostic: {},
  ClickedHelp: {},
})
export type Message = typeof Message.Type
