import { Array, Option } from 'effect'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'

import { Button } from '@foldkit/ui'

import type { Diagnostic, ShaderControl } from './domain/shader'
import { shaderExamples } from './examples'
import { MountEditor, MountRenderer } from './host'
import { Message } from './message'
import { EngineState, type Model, Validation } from './model'

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
            ['◈'],
          ),
          h.h1(
            [h.Class('text-[16px] font-semibold tracking-[-0.5px]')],
            ['codegl'],
          ),
          h.span([h.Class('font-mono text-[10px] text-[#b7a3ee]')], ['V1']),
        ],
      ),
      h.div(
        [
          h.Class(
            'border-l border-line pl-4 text-[12px] text-[#b9bdc5] max-[720px]:hidden',
          ),
        ],
        ['Untitled session'],
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
          h.div(
            [
              h.Class(
                '-ml-3 flex h-full min-w-0 items-center gap-2 border-r border-line bg-panel px-3 font-mono text-[11px] text-[#c3c6cf]',
              ),
            ],
            [
              h.span([h.Class('text-[9px] font-bold text-[#b8a2ee]')], ['W']),
              `${selectedName(model).toLowerCase()}.wgsl`,
              h.span(
                [
                  h.Class('ml-1 text-[15px] text-[#857c99]'),
                  h.Title('Draft editor'),
                ],
                ['•'],
              ),
            ],
          ),
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
          h.div(
            [h.Class('flex items-center gap-2.5')],
            [
              h.kbd(
                [h.Class('text-[#85838e] max-[1000px]:hidden')],
                ['⌘ / Ctrl ↵'],
              ),
              button(
                model.render._tag === 'Compiling'
                  ? 'Compiling…'
                  : 'Render shader',
                Message.PressedRender(),
                `${toolbarButtonClass} border-accent bg-accent text-[#191524] hover:bg-[#d1c1ff]`,
                model.engine._tag !== 'Ready' ||
                  model.render._tag === 'Compiling',
                h,
              ),
            ],
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
  isDisabled: boolean,
  h: HtmlBuilder<Message>,
): Html => {
  const proportion = (control.value - control.min) / (control.max - control.min)
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
        h.Disabled(isDisabled),
        h.Style({ '--range': `${proportion * 100}%` }),
        h.OnInput(value =>
          Message.UpdatedControl({ name: control.name, value: Number(value) }),
        ),
      ]),
      h.div(
        [h.Class('flex justify-between font-mono text-[9px] text-[#686d76]')],
        [h.span([], [String(control.min)]), h.span([], [String(control.max)])],
      ),
    ],
  )
}

const controlsView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.section(
    [
      h.Class(
        'flex max-h-[45%] min-h-0 flex-col overflow-hidden border-t border-line bg-panel max-[720px]:max-h-80',
      ),
      h.AriaLabel('Live shader controls'),
    ],
    [
      h.div(
        [h.Class(panelHeadingClass)],
        [
          h.h2([], ['Parameters']),
          h.span([h.Class(eyebrowClass)], ['GENERATED FROM WGSL']),
        ],
      ),
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
                [h.Class('overflow-auto px-3 py-4 text-[12px] text-[#7e8590]')],
                ['Add an @slider or @knob annotation to expose a parameter.'],
              ),
            onNonEmpty: controls =>
              h.ul(
                [
                  h.Class(
                    'grid min-h-0 grid-cols-[repeat(auto-fit,minmax(100px,1fr))] items-center gap-4 overflow-auto p-3 max-[1000px]:gap-3',
                  ),
                ],
                controls.map(control =>
                  controlView(
                    control,
                    model.render._tag === 'Compiling' ||
                      model.engine._tag !== 'Ready',
                    h,
                  ),
                ),
              ),
          }),
      }),
      h.p(
        [
          h.Class(
            'mt-auto shrink-0 border-t border-line px-3 py-1.5 text-[10px] text-[#747d85]',
          ),
        ],
        ['Adjustments are live. Code changes wait for you.'],
      ),
    ],
  )

const examplesView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class('shrink-0 border-t border-line'), h.AriaLabel('Shader examples')],
    [
      h.div(
        [
          h.Class(
            'flex h-[26px] items-center border-b border-line bg-toolbar px-3 text-[11px] text-[#cfd0d8]',
          ),
        ],
        [h.h2([h.Class('text-[11px]')], ['Examples'])],
      ),
      h.ul(
        [h.Class('grid grid-cols-4 max-[720px]:grid-cols-2')],
        shaderExamples.map((example, index) =>
          h.keyed('li')(
            example.id,
            [
              h.Class(
                'border-line not-first:border-l max-[720px]:odd:border-l-0 max-[720px]:nth-[n+3]:border-t',
              ),
            ],
            [
              Button.view(
                {
                  onClick: Message.SelectedExample({ id: example.id }),
                  toView: attributes =>
                    h.button(
                      [
                        ...attributes.button,
                        h.Class(
                          `example-${example.id} flex size-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[#1a1c20] max-[720px]:gap-2 max-[720px]:px-2 ${example.id === model.exampleId ? 'bg-[#1b1922] shadow-[inset_0_2px_#766593]' : 'bg-[#131518]'}`,
                        ),
                        h.AriaPressed(
                          example.id === model.exampleId ? 'true' : 'false',
                        ),
                      ],
                      [
                        h.div(
                          [
                            h.Class(
                              'example-art relative flex h-8 w-[42px] shrink-0 justify-between overflow-hidden rounded-[2px] p-[3px] font-mono text-[9px] text-[#f4f0ff99]',
                            ),
                            h.AriaHidden(true),
                          ],
                          [
                            h.span([], [`0${index + 1}`]),
                            h.span([h.Class('self-end text-[12px]')], ['↗']),
                          ],
                        ),
                        h.div(
                          [h.Class('min-w-0')],
                          [
                            h.strong(
                              [
                                h.Class(
                                  'text-[12px] font-medium text-[#d0cddc]',
                                ),
                              ],
                              [example.name],
                            ),
                            h.p(
                              [
                                h.Class(
                                  'mt-0.5 truncate text-[10px] text-[#82828f]',
                                ),
                              ],
                              [example.description],
                            ),
                          ],
                        ),
                      ],
                    ),
                },
                h,
              ),
            ],
          ),
        ),
      ),
    ],
  )

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
          'Annotations: kind, name, minimum, maximum, initial value, step. Up to 16 scalar controls. Use controls.name in your shader. Controls follow the live shader until the next successful render.',
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
          examplesView(model, h),
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
      ? 'codegl · Projection'
      : 'codegl · Live shader studio',
  body:
    model.mode === 'projection'
      ? h.main(
          [h.Class('h-screen w-screen cursor-none overflow-hidden bg-black')],
          [canvasView(h)],
        )
      : controlWindowView(model, h),
})
