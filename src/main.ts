import { Array, Clock, Effect, Option, Schema } from 'effect'
import { Command, Dom, type Runtime, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { Listbox, RadioGroup } from '@foldkit/ui'

import { bandLevel, bandsInRange, spectrumBands } from './audio'
import { MidiSignal, matchesMidiSource } from './domain/midi'
import { type OscillatorBinding, oscillatorLevel } from './domain/oscillator'
import { Broadcast, Snapshot } from './domain/session'
import {
  Diagnostic,
  type ShaderControl,
  normalizeControlValue,
  parseControls,
  reconcileControls,
} from './domain/shader'
import { shaderExamples } from './examples'
import { channel, editor, errorReason, renderer } from './host'
import { Message } from './message'
import {
  EngineState,
  Flags,
  type MicrophoneBinding,
  MicrophoneState,
  MidiState,
  Model,
  RenderState,
  SpectrumDrag,
  Validation,
} from './model'
import { ExampleListbox, WaveformRadioGroup } from './view'

export { Message } from './message'
export { Model } from './model'
export { view } from './view'

// FLAGS

export const flags = Effect.gen(function* () {
  const startedAt = yield* Clock.currentTimeMillis
  return yield* Effect.sync(() => {
    const parameters = new URLSearchParams(window.location.search)
    const session = parameters.get('session')
    return Flags.make({
      mode:
        parameters.get('view') === 'projection' && session
          ? 'projection'
          : 'control',
      sessionId: session || crypto.randomUUID(),
      startedAt,
    })
  })
})

export const init: Runtime.ApplicationInit<Model, Message, Flags> = flags => ({
  model: Model.make({
    mode: flags.mode,
    sessionId: flags.sessionId,
    startedAt: flags.startedAt,
    source: shaderExamples[0].source,
    draftGeneration: 0,
    liveGeneration: 0,
    exampleId: shaderExamples[0].id,
    exampleListbox: Listbox.init({ id: 'shader-examples' }),
    engine: EngineState.Starting(),
    validation: Validation.Checking(),
    render: RenderState.Idle(),
    maybeLive: Option.none(),
    maybeIncoming: Option.none(),
    maybeNotice: Option.none(),
    projectionStatus: 'Output ready to connect',
    isHelpOpen: false,
    microphone: MicrophoneState.Idle(),
    microphoneSession: 0,
    microphoneBindings: [],
    oscillatorBindings: [],
    midi: MidiState.Idle(),
    midiSession: 0,
    midiBindings: [],
    maybeMidiLearning: Option.none(),
    waveformRadioGroup: RadioGroup.init({ id: 'oscillator-waveform' }),
    maybeOscillatorPeriodEdit: Option.none(),
    maybeSelectedControl: Option.none(),
    spectrum: [],
    spectrumDrag: SpectrumDrag.Idle(),
  }),
})

// COMMAND

const failureDiagnostic = (error: unknown): Diagnostic => ({
  line: 1,
  column: 1,
  id: 'validation-error',
  severity: 'error',
  message: errorReason(error),
})

export const RenderShader = Command.define('RenderShader', {
  args: { snapshot: Snapshot },
  messages: [Message.CompletedRenderShader],
  execute: ({ snapshot }) =>
    renderer().pipe(
      Effect.flatMap(value =>
        Effect.tryPromise(() =>
          value.render(snapshot.source, snapshot.controls, snapshot.startedAt),
        ),
      ),
      Effect.catch(error => Effect.succeed([failureDiagnostic(error)])),
      Effect.map(diagnostics =>
        Message.CompletedRenderShader({ snapshot, diagnostics }),
      ),
    ),
})

export const UpdateEditor = Command.define('UpdateEditor', {
  args: { source: Schema.String, diagnostics: Schema.Array(Diagnostic) },
  messages: [Message.CompletedUpdateEditor, Message.FailedUpdateEditor],
  execute: ({ source, diagnostics }) =>
    editor().pipe(
      Effect.flatMap(value =>
        Effect.try(() => {
          value.setSource(source)
          value.setDiagnostics(diagnostics, source)
        }),
      ),
      Effect.as(Message.CompletedUpdateEditor()),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedUpdateEditor({ reason: errorReason(error) }),
        ),
      ),
    ),
})

export const ShowDiagnostics = Command.define('ShowDiagnostics', {
  args: { source: Schema.String, diagnostics: Schema.Array(Diagnostic) },
  messages: [Message.CompletedShowDiagnostics],
  execute: ({ source, diagnostics }) =>
    editor().pipe(
      Effect.flatMap(value =>
        Effect.try(() => value.setDiagnostics(diagnostics, source)),
      ),
      Effect.ignore,
      Effect.as(Message.CompletedShowDiagnostics()),
    ),
})

export const BroadcastState = Command.define('BroadcastState', {
  args: { broadcast: Broadcast },
  messages: [Message.CompletedBroadcastState, Message.FailedBroadcastState],
  execute: ({ broadcast }) =>
    channel().pipe(
      Effect.flatMap(value => Effect.try(() => value.postMessage(broadcast))),
      Effect.as(Message.CompletedBroadcastState()),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedBroadcastState({ reason: errorReason(error) }),
        ),
      ),
    ),
})

export const SyncControls = Command.define('SyncControls', {
  args: { snapshot: Snapshot },
  messages: [Message.CompletedSyncControls, Message.FailedSyncControls],
  execute: ({ snapshot }) =>
    renderer().pipe(
      Effect.flatMap(value =>
        Effect.try(() => value.setControls(snapshot.controls)),
      ),
      Effect.as(Message.CompletedSyncControls()),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedSyncControls({ reason: errorReason(error) }),
        ),
      ),
    ),
})

export const OpenProjection = Command.define('OpenProjection', {
  args: { sessionId: Schema.String },
  messages: [Message.CompletedOpenProjection, Message.FailedOpenProjection],
  execute: ({ sessionId }) =>
    Effect.try(() => {
      const url = new URL(window.location.href)
      url.search = new URLSearchParams({
        view: 'projection',
        session: sessionId,
      }).toString()
      const projection = window.open(
        url,
        '_blank',
        'popup,width=1280,height=720',
      )
      if (!projection) {
        throw new Error(
          'Your browser blocked the projection window. Allow pop-ups for this site and try again.',
        )
      }
      projection.opener = null
      return Message.CompletedOpenProjection()
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedOpenProjection({ reason: errorReason(error) }),
        ),
      ),
    ),
})

export const FocusDiagnostic = Command.define('FocusDiagnostic', {
  args: { line: Schema.Number, column: Schema.Number },
  messages: [Message.CompletedFocusDiagnostic],
  execute: ({ line, column }) =>
    editor().pipe(
      Effect.flatMap(value => Effect.try(() => value.focusLine(line, column))),
      Effect.ignore,
      Effect.as(Message.CompletedFocusDiagnostic()),
    ),
})

export const FocusControlInput = Command.define('FocusControlInput', {
  args: { name: Schema.String },
  messages: [Message.CompletedFocusControlInput],
  execute: ({ name }) =>
    Dom.focus(`#control-input-${name}`).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusControlInput()),
    ),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message>

const foldExampleListboxOutMessage = Listbox.OutMessage.match<
  Update.Step<Model, Message>
>({
  Selected:
    ({ value }) =>
    model =>
      Option.match(
        Array.findFirst(shaderExamples, example => example.id === value),
        {
          onNone: () => ({ model }),
          onSome: example => ({
            model: modifyFields(model, {
              source: () => example.source,
              draftGeneration: generation => generation + 1,
              exampleId: () => example.id,
              validation: () => Validation.Checking(),
              maybeNotice: () => Option.none(),
            }),
            commands: [
              UpdateEditor({ source: example.source, diagnostics: [] }),
            ],
          }),
        },
      ),
})

const foldExampleListbox = Update.foldChild({
  update: ExampleListbox.update,
  read: (model: Model) => Option.some(model.exampleListbox),
  write: (model, nextExampleListbox) =>
    modifyFields(model, { exampleListbox: () => nextExampleListbox }),
  toParentMessage: message => Message.GotExampleListboxMessage({ message }),
  foldOutMessage: foldExampleListboxOutMessage,
})

const hasErrors = (diagnostics: ReadonlyArray<Diagnostic>): boolean =>
  diagnostics.some(({ severity }) => severity === 'error')

const notice = (model: Model, reason: string): UpdateReturn => ({
  model: modifyFields(model, { maybeNotice: () => Option.some(reason) }),
})

const startRender = (model: Model, snapshot: Snapshot): UpdateReturn => ({
  model: modifyFields(model, {
    render: () =>
      RenderState.Compiling({ draftGeneration: model.draftGeneration }),
    maybeNotice: () => Option.none(),
  }),
  commands: [RenderShader({ snapshot })],
})

const renderDraft = (model: Model): UpdateReturn => {
  if (model.engine._tag !== 'Ready' || model.render._tag === 'Compiling') {
    return { model }
  }
  const parsed = parseControls(model.source)
  const controls = Option.match(model.maybeLive, {
    onNone: () => parsed.controls,
    onSome: live =>
      model.draftGeneration === model.liveGeneration
        ? reconcileControls(
            parsed.controls,
            parseControls(live.source).controls,
            live.controls,
          )
        : parsed.controls,
  })
  const revision = Option.match(model.maybeLive, {
    onNone: () => 1,
    onSome: live => live.revision + 1,
  })
  return startRender(model, {
    source: model.source,
    controls,
    startedAt: model.startedAt,
    revision,
  })
}

const applyIncoming = (model: Model, snapshot: Snapshot): UpdateReturn => {
  if (
    Option.exists(
      model.maybeIncoming,
      incoming => incoming.revision > snapshot.revision,
    )
  ) {
    return { model }
  }
  const pendingModel = modifyFields(model, {
    maybeIncoming: () => Option.some(snapshot),
  })
  if (model.engine._tag !== 'Ready' || model.render._tag === 'Compiling') {
    return { model: pendingModel }
  }
  return Option.match(model.maybeLive, {
    onNone: () => startRender(pendingModel, snapshot),
    onSome: live => {
      if (snapshot.revision <= live.revision) {
        return { model }
      }
      if (snapshot.source !== live.source) {
        return startRender(pendingModel, snapshot)
      }
      return {
        model: modifyFields(pendingModel, {
          maybeLive: () => Option.some(snapshot),
        }),
        commands: [SyncControls({ snapshot })],
      }
    },
  })
}

const completedRender =
  (model: Model) =>
  ({
    snapshot,
    diagnostics,
  }: typeof Message.CompletedRenderShader.Type): UpdateReturn => {
    const isCurrentDraft = model.source === snapshot.source
    const completedModel = modifyFields(model, {
      render: () => RenderState.Idle(),
      validation: validation =>
        isCurrentDraft ? Validation.Checked({ diagnostics }) : validation,
    })
    if (hasErrors(diagnostics)) {
      const failedModel = modifyFields(completedModel, {
        maybeNotice: () =>
          Option.some(
            Option.isSome(model.maybeLive)
              ? 'Render rejected. The last good shader is still live.'
              : 'Render rejected. No shader is live yet.',
          ),
      })
      if (
        model.mode === 'projection' &&
        Option.exists(
          model.maybeIncoming,
          incoming => incoming.revision > snapshot.revision,
        )
      ) {
        return Option.match(model.maybeIncoming, {
          onNone: () => ({ model: failedModel }),
          onSome: incoming => applyIncoming(failedModel, incoming),
        })
      }
      return {
        model: failedModel,
        commands:
          model.mode === 'control'
            ? [ShowDiagnostics({ source: snapshot.source, diagnostics })]
            : [
                BroadcastState({
                  broadcast: Broadcast.Status({
                    reason: `Projection: ${diagnostics[0]?.message ?? 'render failed'}`,
                  }),
                }),
              ],
      }
    }
    const definitions = parseControls(snapshot.source).controls
    const previousDefinitions = Option.match(model.maybeLive, {
      onNone: () => [],
      onSome: live => parseControls(live.source).controls,
    })
    const isLiveBinding = (binding: { name: string }) =>
      snapshot.controls.some(control => control.name === binding.name)
    const reconciledColor = (
      binding: Pick<MicrophoneBinding, 'name' | 'maybeColor'>,
    ): Option.Option<number> => {
      const color = snapshot.controls.find(
        control => control.name === binding.name && control.kind === 'color',
      )
      const previous = previousDefinitions.find(
        control => control.name === binding.name,
      )
      const definition = definitions.find(
        control => control.name === binding.name,
      )
      return !color
        ? Option.none()
        : previous?.kind === 'color' &&
            previous.value === definition?.value &&
            Option.isSome(binding.maybeColor)
          ? binding.maybeColor
          : Option.some(color.value)
    }
    const liveModel = modifyFields(completedModel, {
      liveGeneration: () =>
        model.render._tag === 'Compiling'
          ? model.render.draftGeneration
          : model.liveGeneration,
      spectrumDrag: () => SpectrumDrag.Idle(),
      maybeLive: () => Option.some(snapshot),
      microphoneBindings: bindings =>
        bindings.filter(isLiveBinding).map(binding =>
          modifyFields(binding, {
            maybeColor: () => reconciledColor(binding),
          }),
        ),
      oscillatorBindings: bindings =>
        bindings.filter(isLiveBinding).map(binding =>
          modifyFields(binding, {
            maybeColor: () => reconciledColor(binding),
          }),
        ),
      midiBindings: bindings =>
        bindings.filter(isLiveBinding).map(binding =>
          modifyFields(binding, {
            maybeColor: () => reconciledColor(binding),
          }),
        ),
      maybeMidiLearning: Option.filter(name =>
        snapshot.controls.some(control => control.name === name),
      ),
      maybeSelectedControl: Option.filter(name =>
        snapshot.controls.some(control => control.name === name),
      ),
    })
    if (model.mode === 'projection') {
      return Option.match(model.maybeIncoming, {
        onNone: () => ({ model: liveModel }),
        onSome: incoming =>
          incoming.revision > snapshot.revision
            ? applyIncoming(liveModel, incoming)
            : {
                model: liveModel,
                commands: [
                  BroadcastState({
                    broadcast: Broadcast.Status({
                      reason: 'Projection is live',
                    }),
                  }),
                ],
              },
      })
    }
    const maybeExample = Option.exists(
      model.maybeLive,
      live => live.source === snapshot.source,
    )
      ? Option.none()
      : Array.findFirst(
          shaderExamples,
          example =>
            example.source === snapshot.source &&
            (example.microphoneBindings !== undefined ||
              example.oscillatorBindings !== undefined),
        )
    return {
      model: Option.match(maybeExample, {
        onNone: () => liveModel,
        onSome: example =>
          modifyFields(liveModel, {
            microphoneBindings: () => example.microphoneBindings?.slice() ?? [],
            oscillatorBindings: () => example.oscillatorBindings?.slice() ?? [],
            midiBindings: bindings =>
              bindings.filter(
                binding =>
                  ![
                    ...(example.microphoneBindings ?? []),
                    ...(example.oscillatorBindings ?? []),
                  ].some(preset => preset.name === binding.name),
              ),
            maybeMidiLearning: () => Option.none(),
            maybeSelectedControl: () =>
              Option.map(
                Array.head([
                  ...(example.microphoneBindings ?? []),
                  ...(example.oscillatorBindings ?? []),
                ]),
                binding => binding.name,
              ),
          }),
      }),
      commands: [
        BroadcastState({ broadcast: Broadcast.State({ snapshot }) }),
        ShowDiagnostics({ source: snapshot.source, diagnostics }),
      ],
    }
  }

const receiveBroadcast =
  (model: Model) =>
  ({ broadcast }: typeof Message.ReceivedBroadcast.Type): UpdateReturn =>
    Broadcast.match(broadcast, {
      Hello: () =>
        model.mode === 'control'
          ? Option.match(model.maybeLive, {
              onNone: () => ({ model }),
              onSome: snapshot => ({
                model,
                commands: [
                  BroadcastState({ broadcast: Broadcast.State({ snapshot }) }),
                ],
              }),
            })
          : { model },
      State: ({ snapshot }) =>
        model.mode === 'projection'
          ? applyIncoming(model, snapshot)
          : { model },
      Status: ({ reason }) =>
        model.mode === 'control'
          ? { model: modifyFields(model, { projectionStatus: () => reason }) }
          : { model },
    })

const syncControlValues = (
  model: Model,
  toControl: (control: ShaderControl) => ShaderControl,
  updatesColor = true,
): UpdateReturn => {
  if (
    model.mode !== 'control' ||
    model.engine._tag !== 'Ready' ||
    model.render._tag === 'Compiling'
  ) {
    return { model }
  }
  return Option.match(model.maybeLive, {
    onNone: () => ({ model }),
    onSome: live => {
      const controls = live.controls.map(toControl)
      const updatedColor = (
        binding: Pick<MicrophoneBinding, 'name' | 'maybeColor'>,
      ): Option.Option<number> => {
        const color = controls.find(
          control => control.name === binding.name && control.kind === 'color',
        )
        return color &&
          color !== live.controls.find(control => control.name === binding.name)
          ? Option.some(color.value)
          : binding.maybeColor
      }
      const nextModel = updatesColor
        ? modifyFields(model, {
            microphoneBindings: Array.map(binding =>
              modifyFields(binding, {
                maybeColor: () => updatedColor(binding),
              }),
            ),
            oscillatorBindings: Array.map(binding =>
              modifyFields(binding, {
                maybeColor: () => updatedColor(binding),
              }),
            ),
            midiBindings: Array.map(binding =>
              modifyFields(binding, {
                maybeColor: () => updatedColor(binding),
              }),
            ),
          })
        : model
      if (
        controls.every(
          (control, index) => control.value === live.controls[index]?.value,
        )
      ) {
        return { model: nextModel }
      }
      const snapshot = modifyFields(live, {
        controls: () => controls,
        revision: revision => revision + 1,
      })
      return {
        model: modifyFields(nextModel, {
          maybeLive: () => Option.some(snapshot),
        }),
        commands: [
          SyncControls({ snapshot }),
          BroadcastState({ broadcast: Broadcast.State({ snapshot }) }),
        ],
      }
    },
  })
}

const updateControl =
  (model: Model) =>
  ({ name, value }: typeof Message.UpdatedControl.Type): UpdateReturn =>
    !Number.isFinite(value) ||
    model.oscillatorBindings.some(binding => binding.name === name) ||
    (model.microphone._tag === 'Ready' &&
      model.microphoneBindings.some(binding => binding.name === name))
      ? { model }
      : syncControlValues(model, control =>
          control.name === name
            ? modifyFields(control, {
                value: () =>
                  Math.min(
                    control.max,
                    Math.max(
                      control.min,
                      control.kind === 'color' ? Math.round(value) : value,
                    ),
                  ),
              })
            : control,
        )

const hasLiveControl = (model: Model, name: string): boolean =>
  model.mode === 'control' &&
  Option.exists(model.maybeLive, live =>
    live.controls.some(control => control.name === name),
  )

const selectedColor = (model: Model, name: string): Option.Option<number> =>
  Option.orElse(
    Option.flatMap(
      Array.findFirst(
        [
          ...model.microphoneBindings,
          ...model.oscillatorBindings,
          ...model.midiBindings,
        ],
        binding => binding.name === name,
      ),
      binding => binding.maybeColor,
    ),
    () =>
      Option.flatMap(model.maybeLive, live =>
        Option.map(
          Array.findFirst(
            live.controls,
            control => control.name === name && control.kind === 'color',
          ),
          control => control.value,
        ),
      ),
  )

const updateOscillator = (
  model: Model,
  name: string,
  transform: (binding: OscillatorBinding) => OscillatorBinding,
): UpdateReturn =>
  !hasLiveControl(model, name)
    ? { model }
    : {
        model: modifyFields(model, {
          oscillatorBindings: Array.map(binding =>
            binding.name === name ? transform(binding) : binding,
          ),
        }),
      }

const updateBinding = (
  model: Model,
  name: string,
  toBinding: (binding: MicrophoneBinding) => MicrophoneBinding,
): UpdateReturn => ({
  model: modifyFields(model, {
    spectrumDrag: () => SpectrumDrag.Idle(),
    microphoneBindings: Array.map(binding =>
      binding.name === name ? toBinding(binding) : binding,
    ),
  }),
})

const selectControlBand = (
  model: Model,
  name: string,
  low: number,
  high: number,
): UpdateReturn =>
  !Number.isFinite(low) ||
  !Number.isFinite(high) ||
  low < 20 ||
  high > 20000 ||
  low >= high
    ? { model }
    : updateBinding(model, name, binding =>
        modifyFields(binding, {
          bands: bands => {
            const preset = bandsInRange(low, high)
            return preset.every(index => bands.includes(index))
              ? bands.filter(index => !preset.includes(index))
              : bands.concat(preset.filter(index => !bands.includes(index)))
          },
        }),
      )

const validSpectrumIndex = (index: number): boolean =>
  Number.isInteger(index) && index >= 0 && index < spectrumBands.length

const startSpectrumSelection = (model: Model, index: number): UpdateReturn => {
  if (!validSpectrumIndex(index) || model.spectrumDrag._tag === 'Dragging') {
    return { model }
  }
  return Option.match(model.maybeSelectedControl, {
    onNone: () => ({ model }),
    onSome: name => {
      const binding = model.microphoneBindings.find(
        binding => binding.name === name,
      )
      if (!binding) {
        return { model }
      }
      const selection = binding.bands.includes(index) ? 'remove' : 'add'
      const dragModel = modifyFields(model, {
        spectrumDrag: () =>
          SpectrumDrag.Dragging({ name, lastIndex: index, selection }),
      })
      return moveSpectrumSelection(dragModel, index)
    },
  })
}

const moveSpectrumSelection = (model: Model, index: number): UpdateReturn => {
  if (!validSpectrumIndex(index)) {
    return { model }
  }
  return SpectrumDrag.match(model.spectrumDrag, {
    Idle: () => ({ model }),
    Dragging: ({ name, lastIndex, selection }) => {
      const first = Math.min(lastIndex, index)
      const last = Math.max(lastIndex, index)
      const crossed = Array.range(first, last)
      return {
        model: modifyFields(model, {
          spectrumDrag: () =>
            SpectrumDrag.Dragging({ name, lastIndex: index, selection }),
          microphoneBindings: Array.map(binding =>
            binding.name !== name
              ? binding
              : modifyFields(binding, {
                  bands: bands =>
                    selection === 'add'
                      ? bands.concat(
                          crossed.filter(band => !bands.includes(band)),
                        )
                      : bands.filter(band => band < first || band > last),
                }),
          ),
        }),
      }
    },
  })
}

const microphoneIsCurrent = (model: Model, sessionId: number): boolean =>
  model.mode === 'control' &&
  model.microphoneSession === sessionId &&
  (model.microphone._tag === 'Starting' || model.microphone._tag === 'Ready')

const midiIsCurrent = (model: Model, sessionId: number): boolean =>
  model.mode === 'control' &&
  model.midiSession === sessionId &&
  (model.midi._tag === 'Starting' || model.midi._tag === 'Ready')

const startMidiLearn = (model: Model, name: string): UpdateReturn => {
  if (
    !hasLiveControl(model, name) ||
    !model.midiBindings.some(binding => binding.name === name)
  ) {
    return { model }
  }
  const needsConnection =
    model.midi._tag === 'Idle' || model.midi._tag === 'Failed'
  return {
    model: modifyFields(model, {
      maybeMidiLearning: () => Option.some(name),
      maybeNotice: () => Option.none(),
      midiBindings: bindings =>
        bindings.filter(
          binding =>
            binding.name === name || Option.isSome(binding.maybeSource),
        ),
      midi: state => (needsConnection ? MidiState.Starting() : state),
      midiSession: session => (needsConnection ? session + 1 : session),
    }),
  }
}

const selectControlInput = (
  model: Model,
  {
    name,
    input,
  }: Pick<typeof Message.SelectedControlInput.Type, 'name' | 'input'>,
): UpdateReturn => {
  if (!hasLiveControl(model, name)) {
    return { model }
  }
  const selected = modifyFields(model, {
    spectrumDrag: () => SpectrumDrag.Idle(),
    maybeOscillatorPeriodEdit: () => Option.none(),
    maybeMidiLearning: Option.filter(learningName => learningName !== name),
    microphoneBindings: bindings =>
      input !== 'microphone'
        ? bindings.filter(binding => binding.name !== name)
        : bindings.some(binding => binding.name === name)
          ? bindings
          : bindings.concat({
              name,
              bands: bandsInRange(20, 250),
              gain: 1,
              maybeColor: selectedColor(model, name),
            }),
    oscillatorBindings: bindings =>
      input !== 'oscillator'
        ? bindings.filter(binding => binding.name !== name)
        : bindings.some(binding => binding.name === name)
          ? bindings
          : bindings.concat({
              name,
              waveform: 'sine',
              period: 4,
              depth: 100,
              phase: 0,
              maybeColor: selectedColor(model, name),
            }),
    midiBindings: bindings =>
      input !== 'midi'
        ? bindings.filter(binding => binding.name !== name)
        : bindings.some(binding => binding.name === name)
          ? bindings
          : bindings.concat({
              name,
              maybeSource: Option.none(),
              maybePendingValue: Option.none(),
              maybeColor: selectedColor(model, name),
            }),
  })
  if (input === 'midi') {
    const binding = selected.midiBindings.find(binding => binding.name === name)
    return binding && Option.isNone(binding.maybeSource)
      ? startMidiLearn(selected, name)
      : { model: selected }
  }
  return {
    model: Array.isReadonlyArrayEmpty(selected.midiBindings)
      ? modifyFields(selected, { midi: () => MidiState.Idle() })
      : selected,
  }
}

const controlAtLevel = (
  control: ShaderControl,
  level: number,
  maybeColor: Option.Option<number>,
): ShaderControl => {
  if (control.kind === 'color') {
    const color = Option.getOrElse(maybeColor, () => control.value)
    return modifyFields(control, {
      value: () =>
        (Math.round(((color >> 16) & 255) * level) << 16) |
        (Math.round(((color >> 8) & 255) * level) << 8) |
        Math.round((color & 255) * level),
    })
  }
  const value = control.min + level * (control.max - control.min)
  return modifyFields(control, {
    value: () => normalizeControlValue(control, value),
  })
}

const syncMidiValues = (model: Model): UpdateReturn => {
  if (
    model.mode !== 'control' ||
    model.engine._tag !== 'Ready' ||
    model.render._tag === 'Compiling'
  ) {
    return { model }
  }
  const nextModel = modifyFields(model, {
    midi: state =>
      Array.isReadonlyArrayEmpty(model.midiBindings) ? MidiState.Idle() : state,
    maybeMidiLearning: Option.filter(name =>
      model.midiBindings.some(binding => binding.name === name),
    ),
    midiBindings: Array.map(binding =>
      modifyFields(binding, { maybePendingValue: () => Option.none() }),
    ),
  })
  return syncControlValues(
    nextModel,
    control => {
      const binding = model.midiBindings.find(
        binding => binding.name === control.name,
      )
      return binding
        ? Option.match(binding.maybePendingValue, {
            onNone: () => control,
            onSome: value =>
              controlAtLevel(control, value / 127, binding.maybeColor),
          })
        : control
    },
    false,
  )
}

const receiveMidiSignal = (
  model: Model,
  { sessionId, signal }: typeof Message.ReceivedMidiSignal.Type,
): UpdateReturn => {
  if (
    !midiIsCurrent(model, sessionId) ||
    model.midi._tag !== 'Ready' ||
    model.engine._tag !== 'Ready' ||
    !Schema.is(MidiSignal)(signal) ||
    !model.midi.inputs.some(input => input.id === signal.source.inputId)
  ) {
    return { model }
  }
  const learned =
    signal.source.kind === 'note' && signal.value === 0
      ? model
      : Option.match(model.maybeMidiLearning, {
          onNone: () => model,
          onSome: name =>
            modifyFields(model, {
              midiBindings: Array.map(binding =>
                binding.name === name
                  ? modifyFields(binding, {
                      maybeSource: () => Option.some(signal.source),
                    })
                  : binding,
              ),
              maybeMidiLearning: () => Option.none(),
            }),
        })
  const pending = modifyFields(learned, {
    midiBindings: Array.map(binding =>
      Option.exists(binding.maybeSource, source =>
        matchesMidiSource(source, signal.source),
      )
        ? modifyFields(binding, {
            maybePendingValue: () => Option.some(signal.value),
          })
        : binding,
    ),
  })
  return syncMidiValues(pending)
}

const tickOscillators = (model: Model, now: number): UpdateReturn => {
  if (!Number.isFinite(now) || now < model.startedAt) {
    return { model }
  }
  return syncControlValues(
    model,
    control => {
      const binding = model.oscillatorBindings.find(
        binding => binding.name === control.name,
      )
      if (!binding) {
        return control
      }
      const wave = oscillatorLevel(binding, (now - model.startedAt) / 1000)
      const depth = binding.depth / 100
      const level =
        control.kind === 'color'
          ? 1 - depth + depth * wave
          : 0.5 + depth * (wave - 0.5)
      return controlAtLevel(control, level, binding.maybeColor)
    },
    false,
  )
}

const updateMicrophoneSpectrum = (
  model: Model,
  { sessionId, spectrum }: typeof Message.UpdatedMicrophoneSpectrum.Type,
): UpdateReturn => {
  if (
    !microphoneIsCurrent(model, sessionId) ||
    model.microphone._tag !== 'Ready' ||
    spectrum.length !== spectrumBands.length ||
    spectrum.some(value => !Number.isFinite(value) || value < 0 || value > 1)
  ) {
    return { model }
  }
  const spectrumModel = modifyFields(model, { spectrum: () => spectrum })
  return syncControlValues(
    spectrumModel,
    control => {
      const binding = model.microphoneBindings.find(
        binding => binding.name === control.name,
      )
      if (!binding) {
        return control
      }
      const level = bandLevel(spectrum, binding.bands, binding.gain)
      return controlAtLevel(control, level, binding.maybeColor)
    },
    false,
  )
}

const rendererFailed =
  (model: Model) =>
  ({ reason }: { reason: string }): UpdateReturn => {
    const failedModel = modifyFields(model, {
      engine: () => EngineState.Failed({ reason }),
      microphone: () => MicrophoneState.Idle(),
      midi: () => MidiState.Idle(),
      maybeMidiLearning: () => Option.none(),
      spectrum: () => [],
    })
    return model.mode === 'projection'
      ? {
          model: failedModel,
          commands: [
            BroadcastState({
              broadcast: Broadcast.Status({
                reason: `Projection unavailable: ${reason}`,
              }),
            }),
          ],
        }
      : { model: failedModel }
  }

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    SucceededMountRenderer: () => {
      const readyModel = modifyFields(model, {
        engine: () => EngineState.Ready(),
      })
      return model.mode === 'control'
        ? renderDraft(readyModel)
        : Option.match(model.maybeIncoming, {
            onNone: () => ({ model: readyModel }),
            onSome: snapshot => applyIncoming(readyModel, snapshot),
          })
    },
    FailedMountRenderer: rendererFailed(model),
    FailedRenderer: rendererFailed(model),
    SucceededMountEditor: () => ({
      model,
      commands: [
        UpdateEditor({
          source: model.source,
          diagnostics:
            model.validation._tag === 'Checked'
              ? model.validation.diagnostics
              : [],
        }),
      ],
    }),
    FailedMountEditor: ({ reason }) => notice(model, reason),
    SucceededMountChannel: () =>
      model.mode === 'projection' && model.engine._tag === 'Failed'
        ? {
            model,
            commands: [
              BroadcastState({
                broadcast: Broadcast.Status({
                  reason: `Projection unavailable: ${model.engine.reason}`,
                }),
              }),
            ],
          }
        : { model },
    FailedMountChannel: ({ reason }) => notice(model, reason),
    UpdatedSource: ({ source }) => ({
      model: modifyFields(model, {
        source: () => source,
        validation: () => Validation.Checking(),
        maybeNotice: () => Option.none(),
      }),
    }),
    GotExampleListboxMessage: ({ message }) =>
      foldExampleListbox(model, message),
    PressedRender: () => renderDraft(model),
    CompletedValidateShader: ({ source, diagnostics }) =>
      source !== model.source
        ? { model }
        : {
            model: modifyFields(model, {
              validation: () => Validation.Checked({ diagnostics }),
            }),
            commands: [ShowDiagnostics({ source, diagnostics })],
          },
    CompletedRenderShader: payload =>
      Update.combine(model, [
        stepModel => completedRender(stepModel)(payload),
        syncMidiValues,
      ]),
    UpdatedControl: updateControl(model),
    ClickedResetControls: () =>
      Option.match(model.maybeLive, {
        onNone: () => ({ model }),
        onSome: live => {
          const defaults = parseControls(live.source).controls
          return syncControlValues(
            model,
            control =>
              defaults.find(candidate => candidate.name === control.name) ??
              control,
          )
        },
      }),
    ClickedControlInput: ({ name }) =>
      !hasLiveControl(model, name)
        ? { model }
        : {
            model: modifyFields(model, {
              spectrumDrag: () => SpectrumDrag.Idle(),
              maybeOscillatorPeriodEdit: () => Option.none(),
              maybeSelectedControl: selected =>
                Option.contains(selected, name)
                  ? Option.none()
                  : Option.some(name),
            }),
          },
    ClosedControlInput: () =>
      Option.match(model.maybeSelectedControl, {
        onNone: () => ({ model }),
        onSome: name => ({
          model: modifyFields(model, {
            spectrumDrag: () => SpectrumDrag.Idle(),
            maybeOscillatorPeriodEdit: () => Option.none(),
            maybeSelectedControl: () => Option.none(),
          }),
          commands: [FocusControlInput({ name })],
        }),
      }),
    CompletedFocusControlInput: () => ({ model }),
    ClickedControlMidi: ({ name }) =>
      Option.contains(model.maybeMidiLearning, name)
        ? selectControlInput(model, { name, input: 'manual' })
        : model.midiBindings.some(binding => binding.name === name)
          ? startMidiLearn(model, name)
          : selectControlInput(model, { name, input: 'midi' }),
    SelectedControlInput: payload => selectControlInput(model, payload),
    ClickedMidiLearn: ({ name }) => startMidiLearn(model, name),
    ClickedCancelMidiLearn: () => ({
      model: modifyFields(model, { maybeMidiLearning: () => Option.none() }),
    }),
    SucceededStartMidi: ({ sessionId, inputs }) =>
      !midiIsCurrent(model, sessionId)
        ? { model }
        : {
            model: modifyFields(model, {
              midi: () => MidiState.Ready({ inputs }),
            }),
          },
    UpdatedMidiInputs: ({ sessionId, inputs }) =>
      !midiIsCurrent(model, sessionId) || model.midi._tag !== 'Ready'
        ? { model }
        : {
            model: modifyFields(model, {
              midi: () => MidiState.Ready({ inputs }),
            }),
          },
    FailedMidi: ({ sessionId, reason }) =>
      !midiIsCurrent(model, sessionId)
        ? { model }
        : {
            model: modifyFields(model, {
              midi: () => MidiState.Failed({ reason }),
              maybeMidiLearning: () => Option.none(),
              maybeNotice: maybeNotice =>
                Option.exists(model.maybeSelectedControl, name =>
                  model.midiBindings.some(binding => binding.name === name),
                )
                  ? maybeNotice
                  : Option.some(reason),
            }),
          },
    ReceivedMidiSignal: payload => receiveMidiSignal(model, payload),
    GotWaveformRadioGroupMessage: ({ controlId: name, message }) =>
      Update.foldChild({
        update: WaveformRadioGroup.update,
        read: (model: Model) =>
          model.oscillatorBindings.some(binding => binding.name === name)
            ? Option.some(model.waveformRadioGroup)
            : Option.none(),
        write: (model, waveformRadioGroup) =>
          modifyFields(model, { waveformRadioGroup: () => waveformRadioGroup }),
        toParentMessage: message =>
          Message.GotWaveformRadioGroupMessage({ controlId: name, message }),
        foldOutMessage: RadioGroup.OutMessage.match<
          Update.Step<Model, Message>,
          RadioGroup.OutMessage<OscillatorBinding['waveform']>
        >({
          Selected:
            ({ value }) =>
            model =>
              updateOscillator(model, name, binding =>
                modifyFields(binding, { waveform: () => value }),
              ),
        }),
      })(model, message),
    UpdatedOscillatorPeriod: ({ name, value }) => {
      if (
        !hasLiveControl(model, name) ||
        !model.oscillatorBindings.some(binding => binding.name === name)
      ) {
        return { model }
      }
      const edited = modifyFields(model, {
        maybeOscillatorPeriodEdit: () => Option.some({ name, value }),
      })
      const period = Number(value)
      return value.trim() === '' ||
        !Number.isFinite(period) ||
        period < 0.1 ||
        period > 120
        ? { model: edited }
        : updateOscillator(edited, name, binding =>
            modifyFields(binding, { period: () => period }),
          )
    },
    BlurredOscillatorPeriod: ({ name }) => ({
      model: modifyFields(model, {
        maybeOscillatorPeriodEdit: Option.filter(edit => edit.name !== name),
      }),
    }),
    UpdatedOscillatorSetting: ({ name, setting, value }) => {
      const minimum = setting === 'period' ? 0.1 : 0
      const maximum =
        setting === 'period' ? 120 : setting === 'depth' ? 100 : 360
      return !Number.isFinite(value) || value < minimum || value > maximum
        ? { model }
        : updateOscillator(model, name, binding =>
            modifyFields(binding, {
              period: period => (setting === 'period' ? value : period),
              depth: depth => (setting === 'depth' ? value : depth),
              phase: phase => (setting === 'phase' ? value : phase),
            }),
          )
    },
    TickedOscillators: ({ now }) => tickOscillators(model, now),
    SelectedControlBand: ({ name, low, high }) =>
      selectControlBand(model, name, low, high),
    ClickedSpectrumBand: ({ name, index }) =>
      !validSpectrumIndex(index)
        ? { model }
        : updateBinding(model, name, binding =>
            modifyFields(binding, {
              bands: bands =>
                bands.includes(index)
                  ? bands.filter(band => band !== index)
                  : bands.concat(index),
            }),
          ),
    StartedSpectrumSelection: ({ index }) =>
      startSpectrumSelection(model, index),
    MovedSpectrumSelection: ({ index }) => moveSpectrumSelection(model, index),
    EndedSpectrumSelection: () => ({
      model: modifyFields(model, { spectrumDrag: () => SpectrumDrag.Idle() }),
    }),
    UpdatedControlGain: ({ name, gain }) =>
      !Number.isFinite(gain) || gain < 0.1 || gain > 8
        ? { model }
        : updateBinding(model, name, binding =>
            modifyFields(binding, { gain: () => gain }),
          ),
    ClickedStartMicrophone: () =>
      model.mode !== 'control' ||
      model.microphone._tag === 'Starting' ||
      model.microphone._tag === 'Ready'
        ? { model }
        : {
            model: modifyFields(model, {
              microphone: () => MicrophoneState.Starting(),
              microphoneSession: session => session + 1,
              spectrum: () => [],
            }),
          },
    ClickedStopMicrophone: () => ({
      model: modifyFields(model, {
        microphone: () => MicrophoneState.Idle(),
        spectrum: () => [],
      }),
    }),
    SucceededStartMicrophone: ({ sessionId }) =>
      !microphoneIsCurrent(model, sessionId)
        ? { model }
        : {
            model: modifyFields(model, {
              microphone: () => MicrophoneState.Ready(),
            }),
          },
    FailedMicrophone: ({ sessionId, reason }) =>
      !microphoneIsCurrent(model, sessionId)
        ? { model }
        : {
            model: modifyFields(model, {
              microphone: () => MicrophoneState.Failed({ reason }),
              spectrum: () => [],
            }),
          },
    UpdatedMicrophoneSpectrum: payload =>
      updateMicrophoneSpectrum(model, payload),
    ReceivedBroadcast: receiveBroadcast(model),
    CompletedSyncControls: () => ({ model }),
    FailedSyncControls: ({ reason }) => notice(model, reason),
    CompletedUpdateEditor: () => ({ model }),
    CompletedShowDiagnostics: () => ({ model }),
    FailedUpdateEditor: ({ reason }) => notice(model, reason),
    CompletedBroadcastState: () => ({ model }),
    FailedBroadcastState: ({ reason }) => notice(model, reason),
    ClickedProjection: () => ({
      model,
      commands: [OpenProjection({ sessionId: model.sessionId })],
    }),
    CompletedOpenProjection: () => ({
      model: modifyFields(model, {
        projectionStatus: () => 'Projection window opened',
        maybeNotice: () => Option.none(),
      }),
    }),
    FailedOpenProjection: ({ reason }) => notice(model, reason),
    ClickedDiagnostic: ({ line, column }) => ({
      model,
      commands: [FocusDiagnostic({ line, column })],
    }),
    CompletedFocusDiagnostic: () => ({ model }),
    ClickedHelp: () => ({
      model: modifyFields(model, { isHelpOpen: value => !value }),
    }),
  })
