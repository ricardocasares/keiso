import { Array, Option } from 'effect'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'

import { Button } from '@foldkit/ui'

import type { Diagnostic, ShaderControl } from './domain/shader'
import { shaderExamples } from './examples'
import { MountEditor, MountRenderer } from './host'
import { Message } from './message'
import { EngineState, type Model, Validation } from './model'

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
    [h.Class('app-header')],
    [
      h.div(
        [h.Class('brand')],
        [
          h.span([h.Class('brand-symbol'), h.AriaHidden(true)], ['◈']),
          h.h1([], ['codegl']),
          h.span([h.Class('version')], ['V1']),
        ],
      ),
      h.div([h.Class('header-caption')], ['A live canvas for your code.']),
      h.div(
        [h.Class('header-actions')],
        [
          button(
            'WGSL guide',
            Message.ClickedHelp(),
            'button subtle',
            false,
            h,
          ),
          button(
            'Projection ↗',
            Message.ClickedProjection(),
            'button projection-button',
            model.engine._tag !== 'Ready',
            h,
          ),
        ],
      ),
    ],
  )

const editorView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class('panel editor-panel'), h.AriaLabel('Shader editor')],
    [
      h.div(
        [h.Class('panel-heading')],
        [
          h.div(
            [h.Class('file-tab')],
            [
              h.span([h.Class('file-icon')], ['W']),
              `${selectedName(model).toLowerCase()}.wgsl`,
              h.span([h.Class('draft-dot'), h.Title('Draft editor')], ['•']),
            ],
          ),
          h.span([h.Class('eyebrow')], ['FRAGMENT SHADER']),
        ],
      ),
      h.div([
        h.Class('code-host'),
        h.OnMount(MountEditor({ source: model.source })),
      ]),
      diagnosticsView(model, h),
      h.div(
        [h.Class('editor-footer')],
        [
          h.span(
            [h.Class('muted')],
            [
              `${model.source.split('\n').length} lines`,
              h.span([h.Class('separator')], ['/']),
              'WGSL',
            ],
          ),
          h.div(
            [h.Class('render-action')],
            [
              h.kbd([], ['⌘ / Ctrl ↵']),
              button(
                model.render._tag === 'Compiling'
                  ? 'Compiling…'
                  : 'Render shader',
                Message.PressedRender(),
                'button render-button',
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
        `diagnostic ${diagnostic.severity}`,
        false,
        h,
      ),
    ],
  )

const diagnosticsView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('diagnostics'), h.Role('status'), h.AriaLive('polite')],
    [
      Validation.match(model.validation, {
        Checking: () =>
          h.p(
            [h.Class('validation-line muted')],
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
                [h.Class('validation-line success')],
                [
                  '✓  No issues found',
                  h.span([h.Class('muted')], ['Ready when you are.']),
                ],
              ),
            onNonEmpty: diagnostics =>
              h.ul(
                [h.Class('diagnostic-list')],
                diagnostics.map(diagnostic => diagnosticView(diagnostic, h)),
              ),
          }),
      }),
    ],
  )

const canvasView = (h: HtmlBuilder<Message>): Html =>
  h.canvas([
    h.Class('render-canvas'),
    h.AriaLabel('Live WGSL render'),
    h.OnMount(MountRenderer()),
  ])

const previewView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class('panel preview-panel'), h.AriaLabel('Live output')],
    [
      h.div(
        [h.Class('panel-heading')],
        [
          h.h2([], ['Live output']),
          h.span(
            [
              h.Class(
                `live-badge ${model.engine._tag === 'Ready' && Option.isSome(model.maybeLive) ? 'is-live' : ''}`,
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
        [h.Class('preview-stage')],
        [
          canvasView(h),
          EngineState.match(model.engine, {
            Starting: () =>
              h.div([h.Class('stage-message')], ['Preparing your canvas…']),
            Ready: () => h.empty,
            Failed: ({ reason }) =>
              h.div(
                [h.Class('stage-message'), h.Role('alert')],
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
        [h.Class('preview-footer')],
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
    [h.Class(`control control-${control.kind}`)],
    [
      h.div(
        [h.Class('control-title')],
        [
          h.label(
            [h.For(`control-${control.name}`)],
            [control.name.replaceAll('_', ' ')],
          ),
          h.output(
            [h.For(`control-${control.name}`)],
            [Number(control.value.toPrecision(6)).toString()],
          ),
        ],
      ),
      control.kind === 'knob'
        ? h.div(
            [
              h.Class('knob'),
              h.AriaHidden(true),
              h.Style({
                '--turn': `${-135 + proportion * 270}deg`,
                '--sweep': `${proportion * 270}deg`,
              }),
            ],
            [h.div([h.Class('knob-cap')], [h.span([h.Class('knob-pointer')])])],
          )
        : h.empty,
      h.input([
        h.Id(`control-${control.name}`),
        h.Type('range'),
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
        [h.Class('control-bounds')],
        [h.span([], [String(control.min)]), h.span([], [String(control.max)])],
      ),
    ],
  )
}

const controlsView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class('panel controls-panel'), h.AriaLabel('Live shader controls')],
    [
      h.div(
        [h.Class('panel-heading')],
        [
          h.h2([], ['Parameters']),
          h.span([h.Class('eyebrow')], ['GENERATED FROM WGSL']),
        ],
      ),
      Option.match(model.maybeLive, {
        onNone: () =>
          h.p(
            [h.Class('empty-controls')],
            ['Your shader’s controls will appear here.'],
          ),
        onSome: live =>
          Array.match(live.controls, {
            onEmpty: () =>
              h.p(
                [h.Class('empty-controls')],
                ['Add an @slider or @knob annotation to expose a parameter.'],
              ),
            onNonEmpty: controls =>
              h.ul(
                [h.Class('controls-grid')],
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
        [h.Class('controls-hint')],
        ['Adjustments are live. Code changes wait for you.'],
      ),
    ],
  )

const examplesView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class('examples'), h.AriaLabel('Shader examples')],
    [
      h.div(
        [h.Class('examples-heading')],
        [
          h.h2([], ['A place to start']),
          h.p([], ['Load a sketch. Make it yours. Render when ready.']),
        ],
      ),
      h.ul(
        [h.Class('example-grid')],
        shaderExamples.map((example, index) =>
          h.keyed('li')(
            example.id,
            [],
            [
              Button.view(
                {
                  onClick: Message.SelectedExample({ id: example.id }),
                  toView: attributes =>
                    h.button(
                      [
                        ...attributes.button,
                        h.Class(
                          `example-card example-${example.id} ${example.id === model.exampleId ? 'selected' : ''}`,
                        ),
                        h.AriaPressed(
                          example.id === model.exampleId ? 'true' : 'false',
                        ),
                      ],
                      [
                        h.div(
                          [h.Class('example-art'), h.AriaHidden(true)],
                          [
                            h.span([], [`0${index + 1}`]),
                            h.span([h.Class('example-arrow')], ['↗']),
                          ],
                        ),
                        h.div(
                          [h.Class('example-copy')],
                          [
                            h.strong([], [example.name]),
                            h.p([], [example.description]),
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
    [h.Class('help-panel')],
    [
      h.h2([], ['Your shader, your controls']),
      h.p(
        [],
        [
          'Write fn fragment(uv: vec2f) -> vec4f. UV runs from 0 to 1. globals.time is seconds; globals.resolution is the canvas size in pixels.',
        ],
      ),
      h.pre(
        [],
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
    [h.Class('application')],
    [
      headerView(model, h),
      h.main(
        [h.Class('workspace')],
        [
          h.div(
            [h.Class('workspace-heading')],
            [
              h.div(
                [],
                [
                  h.span([h.Class('eyebrow')], ['WORKSPACE']),
                  h.span([h.Class('workspace-name')], ['Untitled session']),
                ],
              ),
              h.span([h.Class('session-status')], ['●  LOCAL SESSION']),
            ],
          ),
          model.isHelpOpen ? helpView(h) : h.empty,
          Option.match(model.maybeNotice, {
            onNone: () => h.empty,
            onSome: reason =>
              h.p([h.Class('notice'), h.Role('alert')], [reason]),
          }),
          h.div(
            [h.Class('workspace-grid')],
            [
              editorView(model, h),
              h.div(
                [h.Class('output-column')],
                [previewView(model, h), controlsView(model, h)],
              ),
            ],
          ),
          examplesView(model, h),
        ],
      ),
      h.footer(
        [h.Class('app-footer')],
        [
          h.span([], ['BUILT FOR THE MOMENT']),
          h.span([], [model.projectionStatus]),
          h.span([], ['Foldkit + Effect / WGSL']),
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
      ? h.main([h.Class('projection')], [canvasView(h)])
      : controlWindowView(model, h),
})
