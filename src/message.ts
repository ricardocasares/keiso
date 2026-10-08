import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { HoverIntent, Listbox, RadioGroup } from '@foldkit/ui'

import { MidiInput, MidiSignal } from './domain/midi'
import { Broadcast, Snapshot } from './domain/session'
import { Diagnostic } from './domain/shader'
import { AiApiKey } from './model'

export const Message = defineMessageUnion({
  SucceededMountRenderer: {},
  FailedMountRenderer: { reason: Schema.String },
  FailedRenderer: { reason: Schema.String },
  SucceededMountEditor: {},
  FailedMountEditor: { reason: Schema.String },
  SucceededMountChannel: {},
  FailedMountChannel: { reason: Schema.String },
  UpdatedSource: { source: Schema.String },
  GotExampleListboxMessage: { message: Listbox.Message },
  UpdatedAiPrompt: { value: Schema.String },
  SelectedAiModel: { value: Schema.String },
  UpdatedAiApiKey: { value: AiApiKey },
  UpdatedAiBaseUrl: { value: Schema.String },
  ClickedRefreshAiModels: {},
  CompletedFetchAiModels: { models: Schema.Array(Schema.String) },
  FailedFetchAiModels: { reason: Schema.String },
  ToggledEditorCode: { isIncluded: Schema.Boolean },
  ToggledAiSettings: { isOpen: Schema.Boolean },
  SubmittedAiPrompt: {},
  CompletedGenerateShader: { source: Schema.String },
  CompletedFocusApplyGeneration: {},
  FailedGenerateShader: { reason: Schema.String },
  ClickedApplyGeneration: {},
  GotAiPreviewMessage: { message: HoverIntent.Message },
  SucceededMountGeneratedPreview: { source: Schema.String },
  FailedMountGeneratedPreview: { source: Schema.String, reason: Schema.String },
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
  ClickedResetControls: {},
  ClickedControlInput: { name: Schema.String },
  ClickedControlMidi: { name: Schema.String },
  ClosedControlInput: {},
  CompletedFocusControlInput: {},
  SelectedControlInput: {
    name: Schema.String,
    input: Schema.Literals(['manual', 'microphone', 'oscillator', 'midi']),
  },
  ClickedMidiLearn: { name: Schema.String },
  ClickedCancelMidiLearn: {},
  SucceededStartMidi: {
    sessionId: Schema.Number,
    inputs: Schema.Array(MidiInput),
  },
  UpdatedMidiInputs: {
    sessionId: Schema.Number,
    inputs: Schema.Array(MidiInput),
  },
  FailedMidi: { sessionId: Schema.Number, reason: Schema.String },
  ReceivedMidiSignal: { sessionId: Schema.Number, signal: MidiSignal },
  GotWaveformRadioGroupMessage: {
    controlId: Schema.String,
    message: RadioGroup.Message,
  },
  UpdatedOscillatorPeriod: { name: Schema.String, value: Schema.String },
  BlurredOscillatorPeriod: { name: Schema.String },
  UpdatedOscillatorSetting: {
    name: Schema.String,
    setting: Schema.Literals(['period', 'depth', 'phase']),
    value: Schema.Number,
  },
  TickedOscillators: { now: Schema.Number },
  SelectedControlBand: {
    name: Schema.String,
    low: Schema.Number,
    high: Schema.Number,
  },
  ClickedSpectrumBand: {
    name: Schema.String,
    index: Schema.Number,
  },
  StartedSpectrumSelection: { index: Schema.Number },
  MovedSpectrumSelection: { index: Schema.Number },
  EndedSpectrumSelection: {},
  UpdatedControlGain: { name: Schema.String, gain: Schema.Number },
  ClickedStartMicrophone: {},
  ClickedStopMicrophone: {},
  SucceededStartMicrophone: { sessionId: Schema.Number },
  FailedMicrophone: { sessionId: Schema.Number, reason: Schema.String },
  UpdatedMicrophoneSpectrum: {
    sessionId: Schema.Number,
    spectrum: Schema.Array(Schema.Number),
  },
  ReceivedBroadcast: { broadcast: Broadcast },
  CompletedSyncControls: {},
  FailedSyncControls: { reason: Schema.String },
  CompletedUpdateEditor: {},
  CompletedShowDiagnostics: {},
  FailedUpdateEditor: { reason: Schema.String },
  CompletedBroadcastState: {},
  FailedBroadcastState: { reason: Schema.String },
  CompletedSavePerformance: {},
  FailedSavePerformance: { reason: Schema.String },
  ClickedProjection: {},
  CompletedOpenProjection: {},
  FailedOpenProjection: { reason: Schema.String },
  ClickedDiagnostic: { line: Schema.Number, column: Schema.Number },
  CompletedFocusDiagnostic: {},
  ClickedHelp: {},
})
export type Message = typeof Message.Type
