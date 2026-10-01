import { Array, Option } from 'effect'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'

import { Button, Listbox } from '@foldkit/ui'

import { bandsInRange, spectrumBands } from './audio'
import type { Diagnostic, ShaderControl } from './domain/shader'
import { type ShaderExample, shaderExamples } from './examples'
import { MountEditor, MountRenderer } from './host'
import { Message } from './message'
import {
  EngineState,
  type MicrophoneBinding,
  MicrophoneState,
  type Model,
  Validation,
} from './model'
import { MountSpectrumSelection } from './spectrum'

export const ExampleListbox = Listbox.create<ShaderExample>()

const panelHeadingClass =
  'flex h-8 shrink-0 items-center justify-between gap-3 border-b border-line bg-toolbar px-3 text-[#c9cbd1]'
const eyebrowClass =
  'font-mono text-[9px] tracking-[0.6px] text-[#777e88] max-[1000px]:text-[8px]'
const toolbarButtonClass =
  'rounded-[3px] border px-2.5 py-0.5 text-[12px] leading-[20px] font-medium transition-colors'
const stageMessageClass =
  'absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-auto bg-[#0d1015] p-4 text-center text-[#a8acb4] [&_strong]:text-[#d4c5f4] [&_p]:max-w-[420px] [&_p]:text-[12px] [&_p]:leading-relaxed'

const button = (
  label: string,
  message: Message,
  className: string,
  isDisabled: boolean,
  h: HtmlBuilder<Message>,
): Html =>
  Button.view(
    {
      onClick: message,
      isDisabled,
      toView: attributes =>
        h.button([...attributes.button, h.Class(className)], [label]),
    },
    h,
  )

const dropdownCaret = (className: string, h: HtmlBuilder<Message>): Html =>
  h.svg(
    [
      h.AriaHidden(true),
      h.Class(className),
      h.Fill('none'),
      h.ViewBox('0 0 16 16'),
      h.Stroke('currentColor'),
      h.StrokeWidth('1.5'),
    ],
    [
      h.path([
        h.StrokeLinecap('round'),
        h.StrokeLinejoin('round'),
        h.D('m3 6 5 5 5-5'),
      ]),
    ],
  )

const selectedName = (model: Model): string =>
  Option.match(
    Array.findFirst(shaderExamples, ({ id }) => id === model.exampleId),
    {
      onNone: () => 'Untitled',
      onSome: ({ name }) => name,
    },
  )

const headerView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.header(
    [
      h.Class(
        'flex h-10 shrink-0 items-center gap-4 border-b border-line px-3 max-[720px]:gap-2 max-[720px]:px-2.5',
      ),
    ],
    [
      h.div(
        [h.Class('flex items-center gap-1.5')],
        [
          h.span(
            [
              h.Class('text-[21px] leading-none text-[#c6b8ff]'),
              h.AriaHidden(true),
            ],
            ['ケ'],
          ),
          h.h1(
            [h.Class('text-[16px] font-semibold tracking-[-0.5px]')],
            ['keiso'],
          ),
        ],
      ),
      h.div(
        [h.Class('ml-auto flex items-center gap-1.5 max-[720px]:gap-1')],
        [
          button(
            'WGSL guide',
            Message.ClickedHelp(),
            `${toolbarButtonClass} border-transparent text-[#979ba4] hover:bg-[#202125] hover:text-[#eee]`,
            false,
            h,
          ),
          button(
            'Projection ↗',
            Message.ClickedProjection(),
            `${toolbarButtonClass} border-[#3b3d43] bg-[#1c1e21] text-[#e4e5e8] hover:bg-[#2b2b32]`,
            model.engine._tag !== 'Ready',
            h,
          ),
        ],
      ),
    ],
  )

const editorView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.section(
    [
      h.Class(
        'flex min-h-0 flex-col overflow-hidden border-r border-line bg-panel max-[720px]:h-[60dvh] max-[720px]:min-h-80 max-[720px]:border-r-0 max-[720px]:border-b',
      ),
      h.AriaLabel('Shader editor'),
    ],
    [
      h.div(
        [h.Class(panelHeadingClass)],
        [
          examplesView(model, h),
          h.span([h.Class(eyebrowClass)], ['FRAGMENT SHADER']),
        ],
      ),
      h.div([
        h.Class('min-h-0 flex-1 overflow-hidden'),
        h.OnMount(MountEditor({ source: model.source })),
      ]),
      diagnosticsView(model, h),
      h.div(
        [
          h.Class(
            'flex min-h-[34px] shrink-0 items-center justify-between border-t border-line bg-status px-2.5 py-0.5 font-mono text-[10px]',
          ),
        ],
        [
          h.span(
            [h.Class('text-muted')],
            [
              `${model.source.split('\n').length} lines`,
              h.span([h.Class('mx-2 text-[#454950]')], ['/']),
              'WGSL',
            ],
          ),
          Button.view(
            {
              onClick: Message.PressedRender(),
              isDisabled:
                model.engine._tag !== 'Ready' ||
                model.render._tag === 'Compiling' ||
                Option.exists(
                  model.maybeLive,
                  live => live.source === model.source,
                ),
              toView: attributes =>
                h.button(
                  [
                    ...attributes.button,
                    h.AriaLabel('Render shader'),
                    h.Title('Render shader (⌘+Enter)'),
                    h.Class(
                      'rounded-[3px] border border-[#655982] bg-[#292333] px-1.5 py-0.5 text-[10px] leading-4 text-[#d5c5ff] transition-colors enabled:hover:bg-[#3a304b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c6b8ff] data-disabled:cursor-not-allowed data-disabled:border-[#3b3d43] data-disabled:bg-[#1c1e21] data-disabled:opacity-40',
                    ),
                  ],
                  [h.kbd([], ['⌘+Enter'])],
                ),
            },
            h,
          ),
        ],
      ),
    ],
  )

const diagnosticView = (
  diagnostic: Diagnostic,
  h: HtmlBuilder<Message>,
): Html =>
  h.keyed('li')(
    diagnostic.id,
    [],
    [
      button(
        `L${diagnostic.line}:${diagnostic.column}  ${diagnostic.message}`,
        Message.ClickedDiagnostic({
          line: diagnostic.line,
          column: diagnostic.column,
        }),
        `w-full bg-transparent p-1 text-left font-mono text-[11px] leading-normal ${diagnostic.severity === 'error' ? 'text-[#f4a5a5]' : diagnostic.severity === 'warning' ? 'text-[#e9c886]' : 'text-[#a2b9e8]'}`,
        false,
        h,
      ),
    ],
  )

const diagnosticsView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Class(
        'max-h-[140px] min-h-[26px] overflow-auto border-t border-[#263532] bg-[#131919]',
      ),
      h.Role('status'),
      h.AriaLive('polite'),
    ],
    [
      Validation.match(model.validation, {
        Checking: () =>
          h.p(
            [h.Class('flex items-center px-3 py-1 text-[11px] text-muted')],
            [
              model.engine._tag === 'Starting'
                ? '○  Starting WebGPU…'
                : model.engine._tag === 'Failed'
                  ? '○  Validation unavailable'
                  : '○  Checking your draft…',
            ],
          ),
        Checked: ({ diagnostics }) =>
          Array.match(diagnostics, {
            onEmpty: () =>
              h.p(
                [
                  h.Class(
                    'flex items-center px-3 py-1 text-[11px] text-[#9bd0b4]',
                  ),
                ],
                ['✓  No issues found'],
              ),
            onNonEmpty: diagnostics =>
              h.ul(
                [h.Class('px-2 py-1')],
                diagnostics.map(diagnostic => diagnosticView(diagnostic, h)),
              ),
          }),
      }),
    ],
  )

const canvasView = (h: HtmlBuilder<Message>): Html =>
  h.canvas([
    h.Class('block size-full bg-black'),
    h.AriaLabel('Live WGSL render'),
    h.OnMount(MountRenderer()),
  ])

const previewView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.section(
    [
      h.Class('flex min-h-0 flex-1 flex-col overflow-hidden bg-panel'),
      h.AriaLabel('Live output'),
    ],
    [
      h.div(
        [h.Class(panelHeadingClass)],
        [
          h.h2([], ['Live output']),
          h.span(
            [
              h.Class(
                `font-mono text-[9px] tracking-[0.6px] ${model.engine._tag === 'Ready' && Option.isSome(model.maybeLive) ? 'text-[#a7d8b6]' : 'text-[#7b8089]'}`,
              ),
            ],
            [
              model.engine._tag === 'Failed'
                ? '○ OFFLINE'
                : Option.isSome(model.maybeLive)
                  ? '● LIVE'
                  : '○ STANDBY',
            ],
          ),
        ],
      ),
      h.div(
        [
          h.Class(
            'relative min-h-0 flex-1 overflow-hidden bg-black max-[720px]:aspect-video max-[720px]:flex-none',
          ),
        ],
        [
          canvasView(h),
          EngineState.match(model.engine, {
            Starting: () =>
              h.div([h.Class(stageMessageClass)], ['Preparing your canvas…']),
            Ready: () => h.empty,
            Failed: ({ reason }) =>
              h.div(
                [h.Class(stageMessageClass), h.Role('alert')],
                [
                  h.strong([], ['WebGPU unavailable']),
                  h.p([], [reason]),
                  h.p(
                    [],
                    [
                      'Open this app in a WebGPU-capable browser over HTTPS or localhost.',
                    ],
                  ),
                ],
              ),
          }),
        ],
      ),
      h.div(
        [
          h.Class(
            'flex min-h-[26px] shrink-0 items-center justify-between gap-3 border-t border-line bg-status px-3 py-1 font-mono text-[9px] text-[#828a93]',
          ),
        ],
        [
          h.span([], ['WEBGPU']),
          h.span(
            [],
            [
              Option.exists(
                model.maybeLive,
                live => live.source === model.source,
              )
                ? 'Draft is live'
                : Option.isSome(model.maybeLive)
                  ? 'Live shader protected · unpublished edits'
                  : 'Waiting for first render',
            ],
          ),
        ],
      ),
    ],
  )

const controlView = (
  control: ShaderControl,
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const proportion = (control.value - control.min) / (control.max - control.min)
  const maybeBinding = Array.findFirst(
    model.microphoneBindings,
    binding => binding.name === control.name,
  )
  const isSelected = Option.contains(model.maybeSelectedControl, control.name)
  const inputLabel = Option.match(maybeBinding, {
    onNone: () => '+ Input',
    onSome: binding =>
      `Mic · ${selectedBandsLabel(binding)} · ${MicrophoneState.match(
        model.microphone,
        {
          Idle: () => 'off',
          Starting: () => 'starting',
          Ready: () => 'live',
          Failed: () => 'unavailable',
        },
      )}`,
  })
  return h.keyed('li')(
    control.name,
    [h.Class('min-w-0')],
    [
      h.div(
        [h.Class('mb-2 flex items-center justify-between gap-1.5 text-[11px]')],
        [
          h.label(
            [
              h.For(`control-${control.name}`),
              h.Class('wrap-anywhere text-[#9da3ad] capitalize'),
            ],
            [control.name.replaceAll('_', ' ')],
          ),
          h.output(
            [
              h.For(`control-${control.name}`),
              h.AriaLive('off'),
              h.Class(
                'rounded-[2px] bg-[#24202e] px-1 py-0.5 font-mono text-[10px] text-[#d3c3fc]',
              ),
            ],
            [Number(control.value.toPrecision(6)).toString()],
          ),
        ],
      ),
      control.kind === 'knob'
        ? h.div(
            [
              h.Class('knob mx-auto mb-2 size-[42px] rounded-full p-[3px]'),
              h.AriaHidden(true),
              h.Style({
                '--turn': `${-135 + proportion * 270}deg`,
                '--sweep': `${proportion * 270}deg`,
              }),
            ],
            [
              h.div(
                [
                  h.Class(
                    'knob-cap relative size-full rotate-(--turn) rounded-full border-[3px] border-panel shadow-[0_3px_9px_#0007]',
                  ),
                ],
                [
                  h.span([
                    h.Class(
                      'absolute top-1 left-[calc(50%-1px)] h-[9px] w-0.5 rounded-[2px] bg-[#ccbcf8]',
                    ),
                  ]),
                ],
              ),
            ],
          )
        : h.empty,
      h.input([
        h.Id(`control-${control.name}`),
        h.Type('range'),
        h.Class('shader-range'),
        h.Min(String(control.min)),
        h.Max(String(control.max)),
        h.Step(String(control.step)),
        h.Value(String(control.value)),
        h.Disabled(
          model.render._tag === 'Compiling' ||
            model.engine._tag !== 'Ready' ||
            (Option.isSome(maybeBinding) && model.microphone._tag === 'Ready'),
        ),
        h.Style({ '--range': `${proportion * 100}%` }),
        h.OnInput(value =>
          Message.UpdatedControl({ name: control.name, value: Number(value) }),
        ),
      ]),
      h.div(
        [h.Class('flex justify-between font-mono text-[9px] text-[#686d76]')],
        [h.span([], [String(control.min)]), h.span([], [String(control.max)])],
      ),
      h.button(
        [
          h.Type('button'),
          h.Class(
            `mt-2 w-full truncate rounded border px-1.5 py-1 text-left text-[10px] ${isSelected ? 'border-[#82709e] bg-[#292331] text-[#dcccfb]' : 'border-line text-[#a29aaf] hover:border-[#6a5c7e] hover:text-[#dcccfb]'}`,
          ),
          h.AriaLabel(`Input for ${control.name}`),
          h.AriaExpanded(isSelected),
          h.Id(`control-input-${control.name}`),
          h.AriaControls(`control-input-editor-${control.name}`),
          h.Title(inputLabel),
          h.OnClick(Message.ClickedControlInput({ name: control.name })),
        ],
        [inputLabel],
      ),
    ],
  )
}

const frequency = (value: number): string =>
  value >= 1000
    ? `${Number((value / 1000).toFixed(1))} kHz`
    : `${Math.round(value)} Hz`

const frequencyRange = (band: { low: number; high: number }): string =>
  `${frequency(band.low)}–${frequency(band.high)}`

const selectedBandsLabel = (binding: MicrophoneBinding): string =>
  Array.isReadonlyArrayEmpty(binding.bands)
    ? 'No bands'
    : `${binding.bands.length} ${binding.bands.length === 1 ? 'band' : 'bands'}`

const microphoneToolbarView = (model: Model, h: HtmlBuilder<Message>): Html =>
  MicrophoneState.match(model.microphone, {
    Idle: () => h.span([h.Class(eyebrowClass)], ['GENERATED FROM WGSL']),
    Failed: () => h.span([h.Class(eyebrowClass)], ['MIC UNAVAILABLE']),
    Starting: () =>
      button(
        'Cancel microphone',
        Message.ClickedStopMicrophone(),
        'text-[10px] text-[#a7a0b6] hover:text-white',
        false,
        h,
      ),
    Ready: () =>
      button(
        '● Stop microphone',
        Message.ClickedStopMicrophone(),
        'text-[10px] text-[#a7d8b6] hover:text-white',
        false,
        h,
      ),
  })

const microphoneStatusView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Class('shrink-0 whitespace-nowrap'),
      h.Title('Audio is processed locally. Nothing is recorded.'),
    ],
    [
      MicrophoneState.match(model.microphone, {
        Idle: () =>
          button(
            'Start mic',
            Message.ClickedStartMicrophone(),
            `${toolbarButtonClass} border-[#67547d] bg-[#302739] text-[#e0d0fb]`,
            false,
            h,
          ),
        Starting: () =>
          h.span(
            [h.Role('status'), h.Class('text-[11px] text-[#b4a8c7]')],
            ['Awaiting permission…'],
          ),
        Ready: () =>
          h.span(
            [h.Role('status'), h.Class('text-[11px] text-[#a7d8b6]')],
            ['● Live'],
          ),
        Failed: () =>
          button(
            'Retry mic',
            Message.ClickedStartMicrophone(),
            `${toolbarButtonClass} border-[#67547d] bg-[#302739] text-[#e0d0fb]`,
            false,
            h,
          ),
      }),
    ],
  )

const microphoneView = (
  binding: MicrophoneBinding,
  model: Model,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('mt-2 space-y-2')],
    [
      MicrophoneState.match(model.microphone, {
        Idle: () => h.empty,
        Starting: () => h.empty,
        Ready: () => h.empty,
        Failed: ({ reason }) =>
          h.p(
            [h.Role('alert'), h.Class('text-[11px] text-[#e9b6a8]')],
            [reason],
          ),
      }),
      h.div(
        [],
        [
          h.div(
            [
              h.Class(
                'mb-1.5 flex justify-between gap-2 text-[10px] text-[#a29aaa]',
              ),
            ],
            [
              h.span([], ['Spectrum · click or drag to toggle bands']),
              h.output(
                [h.Class('font-mono text-[#c8b7ec]')],
                [selectedBandsLabel(binding)],
              ),
            ],
          ),
          h.div(
            [
              h.Class(
                'flex h-[72px] touch-none select-none items-end gap-px overflow-hidden rounded border border-line bg-[#0c0e11] p-1',
              ),
              h.AriaLabel('Microphone spectrum'),
              h.OnMount(MountSpectrumSelection()),
            ],
            spectrumBands.map((band, index) => {
              const isSelected = binding.bands.includes(index)
              return h.keyed('button')(
                String(band.low),
                [
                  h.Type('button'),
                  h.DataAttribute('spectrum-band', String(index)),
                  h.AriaLabel(frequencyRange(band)),
                  h.AriaPressed(isSelected ? 'true' : 'false'),
                  h.Title(frequencyRange(band)),
                  h.Class(
                    `flex h-full min-w-0 flex-1 items-end hover:bg-[#3b324c] ${isSelected ? 'bg-[#272030]' : ''}`,
                  ),
                  h.OnClick(
                    Message.ClickedSpectrumBand({
                      name: binding.name,
                      index,
                    }),
                  ),
                ],
                [
                  h.span([
                    h.Class(
                      `block w-full min-h-[2px] ${isSelected ? 'bg-[#c0a4fc]' : 'bg-[#4c5967]'}`,
                    ),
                    h.Style({
                      height: `${(model.spectrum[index] ?? 0) * 100}%`,
                    }),
                  ]),
                ],
              )
            }),
          ),
          h.div(
            [
              h.Class(
                'mt-1 flex justify-between font-mono text-[9px] text-[#707580]',
              ),
            ],
            [
              h.span([], ['20 Hz']),
              h.span([], ['200 Hz']),
              h.span([], ['2 kHz']),
              h.span([], ['20 kHz']),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('flex flex-wrap items-center gap-x-3 gap-y-1.5')],
        [
          h.div(
            [h.Class('flex items-center gap-1.5')],
            [
              { label: 'Bass', low: 20, high: 250 },
              { label: 'Mids', low: 250, high: 4000 },
              { label: 'Highs', low: 4000, high: 16000 },
            ].map(band => {
              const presetBands = bandsInRange(band.low, band.high)
              const isSelected = presetBands.every(index =>
                binding.bands.includes(index),
              )
              return h.keyed('button')(
                band.label,
                [
                  h.Type('button'),
                  h.Class(
                    `rounded border px-2 py-0.5 text-[10px] ${isSelected ? 'border-[#786292] bg-[#33293e] text-[#dac8f8]' : 'border-line text-[#aaa3b5] hover:border-[#786292]'}`,
                  ),
                  h.AriaPressed(isSelected ? 'true' : 'false'),
                  h.OnClick(
                    Message.SelectedControlBand({
                      name: binding.name,
                      low: band.low,
                      high: band.high,
                    }),
                  ),
                ],
                [band.label],
              )
            }),
          ),
          h.label(
            [
              h.Class(
                'flex min-w-40 flex-1 items-center gap-2 text-[10px] text-[#a4a0ac]',
              ),
            ],
            [
              h.span(
                [h.Class('whitespace-nowrap')],
                [`Gain · ${binding.gain.toFixed(1)}×`],
              ),
              h.input([
                h.Type('range'),
                h.Class('shader-range min-w-16 flex-1'),
                h.AriaLabel('Microphone gain'),
                h.Min('0.1'),
                h.Max('8'),
                h.Step('0.1'),
                h.Value(String(binding.gain)),
                h.OnInput(value =>
                  Message.UpdatedControlGain({
                    name: binding.name,
                    gain: Number(value),
                  }),
                ),
              ]),
            ],
          ),
        ],
      ),
    ],
  )

const controlInputView = (
  name: string,
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const maybeBinding = Array.findFirst(
    model.microphoneBindings,
    binding => binding.name === name,
  )
  return h.div(
    [
      h.Class('border-t border-line bg-[#16141b] px-3 py-2'),
      h.Id(`control-input-editor-${name}`),
      h.Role('group'),
      h.AriaLabel(`Input for ${name}`),
    ],
    [
      h.div(
        [h.Class('flex flex-wrap items-center gap-x-3 gap-y-1.5')],
        [
          h.h3(
            [
              h.Class(
                'text-[12px] font-medium whitespace-nowrap text-[#d2c7e6]',
              ),
            ],
            [`Input · ${name}`],
          ),
          h.div(
            [h.Class('flex items-center gap-2')],
            [
              h.label(
                [h.Class('flex items-center gap-2 text-[11px] text-[#a9a2b3]')],
                [
                  'Source',
                  h.span(
                    [h.Class('relative inline-flex items-center')],
                    [
                      h.select(
                        [
                          h.AriaLabel('Input source'),
                          h.Class(
                            'appearance-none rounded border border-[#3e3649] bg-[#211c29] py-1 pl-2 pr-7 text-[11px] text-[#d3c8e5]',
                          ),
                          h.Value(
                            Option.isSome(maybeBinding)
                              ? 'microphone'
                              : 'manual',
                          ),
                          h.OnChange(input =>
                            Message.SelectedControlInput({
                              name,
                              input:
                                input === 'microphone'
                                  ? 'microphone'
                                  : 'manual',
                            }),
                          ),
                        ],
                        [
                          h.option([h.Value('manual')], ['Manual']),
                          h.option([h.Value('microphone')], ['Microphone']),
                        ],
                      ),
                      dropdownCaret(
                        'pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-[#b5a6ca]',
                        h,
                      ),
                    ],
                  ),
                ],
              ),
              Option.isSome(maybeBinding)
                ? microphoneStatusView(model, h)
                : h.empty,
            ],
          ),
          button(
            'Close input',
            Message.ClosedControlInput(),
            'ml-auto text-[10px] whitespace-nowrap text-[#91859e] hover:text-white',
            false,
            h,
          ),
        ],
      ),
      Option.match(maybeBinding, {
        onNone: () => h.empty,
        onSome: binding => microphoneView(binding, model, h),
      }),
    ],
  )
}

const controlsView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.section(
    [
      h.Class(
        'flex max-h-[55%] min-h-0 shrink-0 flex-col overflow-hidden border-t border-line bg-panel max-[720px]:max-h-[70dvh]',
      ),
      h.AriaLabel('Live shader controls'),
    ],
    [
      h.div(
        [h.Class(panelHeadingClass)],
        [
          h.h2([], ['Controls']),
          h.div(
            [h.Class('flex items-center gap-3')],
            [
              microphoneToolbarView(model, h),
              h.button(
                [
                  h.Type('button'),
                  h.Class(
                    'text-[10px] text-[#a7a0b6] hover:text-white disabled:opacity-40',
                  ),
                  h.AriaLabel('Reset controls to code defaults'),
                  h.Title(
                    'Reset to defaults in the live shader. Microphone inputs stay active.',
                  ),
                  h.Disabled(
                    model.engine._tag !== 'Ready' ||
                      model.render._tag === 'Compiling' ||
                      Option.match(model.maybeLive, {
                        onNone: () => true,
                        onSome: live =>
                          Array.isReadonlyArrayEmpty(live.controls),
                      }),
                  ),
                  h.OnClick(Message.ClickedResetControls()),
                ],
                ['Reset'],
              ),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('min-h-0 overflow-auto')],
        [
          Option.match(model.maybeLive, {
            onNone: () =>
              h.p(
                [h.Class('overflow-auto px-3 py-4 text-[12px] text-[#7e8590]')],
                ['Your shader’s controls will appear here.'],
              ),
            onSome: live =>
              Array.match(live.controls, {
                onEmpty: () =>
                  h.p(
                    [
                      h.Class(
                        'overflow-auto px-3 py-4 text-[12px] text-[#7e8590]',
                      ),
                    ],
                    ['Add an @slider or @knob annotation to expose a control.'],
                  ),
                onNonEmpty: controls =>
                  h.ul(
                    [
                      h.Class(
                        'grid grid-cols-[repeat(auto-fit,minmax(100px,1fr))] items-start gap-4 p-3 max-[1000px]:gap-3',
                      ),
                    ],
                    controls.map(control => controlView(control, model, h)),
                  ),
              }),
          }),
          Option.match(model.maybeSelectedControl, {
            onNone: () => h.empty,
            onSome: name => controlInputView(name, model, h),
          }),
        ],
      ),
    ],
  )

const examplesView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'shader-examples',
    model: model.exampleListbox,
    view: ExampleListbox.view,
    viewInputs: {
      items: shaderExamples,
      itemToValue: example => example.id,
      itemToSearchText: example => example.name,
      maybeSelectedValue: Option.some(model.exampleId),
      ariaLabel: 'Shader examples',
      className: 'relative -ml-3 h-full min-w-0',
      buttonClassName:
        'flex h-full max-w-full items-center gap-2 border-r border-line bg-panel px-3 font-mono text-[11px] text-[#c3c6cf] hover:bg-[#202125] data-[open]:bg-[#202125]',
      buttonContent: h.div(
        [h.Class('flex min-w-0 items-center gap-2')],
        [
          h.span(
            [
              h.Class('text-[9px] font-bold text-[#b8a2ee]'),
              h.AriaHidden(true),
            ],
            ['W'],
          ),
          h.span(
            [h.Class('truncate')],
            [`${selectedName(model).toLowerCase()}.wgsl`],
          ),
          h.span(
            [
              h.Class('text-[15px] text-[#857c99]'),
              h.Title('Draft editor'),
              h.AriaHidden(true),
            ],
            ['•'],
          ),
          dropdownCaret('size-3 shrink-0 text-[#9b93a8]', h),
        ],
      ),
      itemsClassName:
        'z-30 w-[300px] max-w-[calc(100vw-16px)] overflow-hidden border border-line bg-toolbar p-1 shadow-lg outline-none',
      itemsScrollClassName: 'max-h-[min(320px,60dvh)] overflow-y-auto',
      backdropClassName: 'fixed inset-0 z-20',
      anchor: { placement: 'bottom-start', gap: 0, padding: 8 },
      itemToConfig: example => ({
        className: `example-${example.id} group cursor-pointer px-2 py-2 select-none data-[active]:bg-[#292431]`,
        content: h.div(
          [h.Class('flex items-center gap-2.5')],
          [
            h.div([
              h.Class('example-art size-8 shrink-0 rounded-[2px]'),
              h.AriaHidden(true),
            ]),
            h.div(
              [h.Class('min-w-0 flex-1')],
              [
                h.span(
                  [h.Class('text-[12px] font-medium text-[#d0cddc]')],
                  [example.name],
                ),
                h.p(
                  [h.Class('mt-0.5 text-[10px] leading-normal text-[#82828f]')],
                  [example.description],
                ),
              ],
            ),
            h.span(
              [
                h.Class(
                  'invisible text-[#c6b8ff] group-data-[selected]:visible',
                ),
                h.AriaHidden(true),
              ],
              ['✓'],
            ),
          ],
        ),
      }),
    },
    toParentMessage: message => Message.GotExampleListboxMessage({ message }),
  })

const helpView = (h: HtmlBuilder<Message>): Html =>
  h.section(
    [
      h.Class(
        'max-h-[40%] shrink-0 overflow-auto border-b border-[#433b50] bg-[#19171f] p-3 max-[720px]:max-h-[40dvh] [&_p]:mt-2 [&_p]:text-[12px] [&_p]:leading-normal [&_p]:text-[#a3a0ad]',
      ),
    ],
    [
      h.h2([], ['Your shader, your controls']),
      h.p(
        [],
        [
          'Write fn fragment(uv: vec2f) -> vec4f. UV runs from 0 to 1. globals.time is seconds; globals.resolution is the canvas size in pixels.',
        ],
      ),
      h.pre(
        [
          h.Class(
            'mt-2 overflow-auto rounded bg-[#100f16] p-2.5 font-mono text-[12px] leading-normal text-[#bcb0de]',
          ),
        ],
        [
          '// @slider speed 0 3 1 0.01\n// @knob intensity 0 2 1 0.01\n\nfn fragment(uv: vec2f) -> vec4f {\n  return vec4f(uv, sin(globals.time * controls.speed), 1.0);\n}',
        ],
      ),
      h.p(
        [],
        [
          'Annotations: kind, name, minimum, maximum, default value, step. Up to 16 scalar controls. Use controls.name in your shader.',
        ],
      ),
      h.p(
        [],
        [
          'Rendering preserves values by control name. Changing a default resets only that control; range and step changes clamp and snap its value. New or renamed controls start at their defaults. Examples start from their defaults on successful render. Reset restores the live shader’s defaults, even if the editor has unsaved changes. Microphone inputs stay active.',
        ],
      ),
      h.p(
        [],
        [
          'Cmd/Ctrl+Enter renders. Cmd/Ctrl+Space completes. Tab indents; Escape then Tab leaves the editor. Click a diagnostic to jump to its line. Use your browser’s fullscreen shortcut in the projection window.',
        ],
      ),
    ],
  )

const controlWindowView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Class(
        'flex h-dvh min-h-[460px] flex-col max-[720px]:h-auto max-[720px]:min-h-dvh',
      ),
    ],
    [
      headerView(model, h),
      h.main(
        [h.Class('flex min-h-0 flex-1 flex-col')],
        [
          model.isHelpOpen ? helpView(h) : h.empty,
          Option.match(model.maybeNotice, {
            onNone: () => h.empty,
            onSome: reason =>
              h.p(
                [
                  h.Class(
                    'max-h-[20%] shrink-0 overflow-auto border-b border-[#5b4435] bg-[#251d17] px-3 py-1.5 text-[12px] text-[#e9c6aa] max-[720px]:max-h-[40dvh]',
                  ),
                  h.Role('alert'),
                ],
                [reason],
              ),
          }),
          h.div(
            [
              h.Class(
                'grid min-h-0 flex-1 grid-cols-[minmax(0,1.06fr)_minmax(0,1fr)] max-[720px]:grid-cols-1',
              ),
            ],
            [
              editorView(model, h),
              h.div(
                [h.Class('flex min-h-0 min-w-0 flex-col')],
                [previewView(model, h), controlsView(model, h)],
              ),
            ],
          ),
        ],
      ),
      h.footer(
        [
          h.Class(
            'flex min-h-[26px] shrink-0 items-center justify-between gap-4 border-t border-line px-3 py-1 font-mono text-[9px] text-[#646d75] max-[720px]:flex-wrap max-[720px]:gap-2',
          ),
        ],
        [
          h.span(
            [h.Class('tracking-[0.5px] text-[#8faaa0] max-[720px]:text-[8px]')],
            ['●  LOCAL SESSION'],
          ),
          h.span([], [model.projectionStatus]),
          h.span([h.Class('max-[720px]:hidden')], ['WGSL / WebGPU']),
        ],
      ),
    ],
  )

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title:
    model.mode === 'projection'
      ? 'keiso · Projection'
      : 'keiso · Live shader studio',
  body:
    model.mode === 'projection'
      ? h.main(
          [h.Class('h-screen w-screen cursor-none overflow-hidden bg-black')],
          [canvasView(h)],
        )
      : controlWindowView(model, h),
})
