import { basicSetup } from 'codemirror'

import {
  type CompletionContext,
  completeAnyWord,
  completeFromList,
} from '@codemirror/autocomplete'
import { indentWithTab } from '@codemirror/commands'
import {
  HighlightStyle,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language'
import { lintGutter, setDiagnostics } from '@codemirror/lint'
import { Annotation, Compartment, EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { wgsl, wgslLanguage } from '@iizukak/codemirror-lang-wgsl'
import { tags } from '@lezer/highlight'

import { type Diagnostic, parseControls } from './domain/shader'

export type ShaderEditor = {
  setSource: (source: string) => void
  setDiagnostics: (
    diagnostics: ReadonlyArray<Diagnostic>,
    source: string,
  ) => void
  focusLine: (line: number, column: number) => void
  setReadOnly: (readOnly: boolean) => void
  dispose: () => void
}

const reflectedSource = Annotation.define<boolean>()

const completions = completeFromList([
  ...[
    'abs',
    'acos',
    'asin',
    'atan',
    'atan2',
    'ceil',
    'clamp',
    'cos',
    'cross',
    'distance',
    'dot',
    'exp',
    'exp2',
    'floor',
    'fract',
    'length',
    'log',
    'log2',
    'max',
    'min',
    'mix',
    'normalize',
    'pow',
    'reflect',
    'round',
    'select',
    'sign',
    'sin',
    'smoothstep',
    'sqrt',
    'step',
    'tan',
    'transpose',
  ].map(label => ({ label, type: 'function' })),
  ...[
    'f32',
    'i32',
    'u32',
    'bool',
    'vec2f',
    'vec3f',
    'vec4f',
    'mat2x2f',
    'mat3x3f',
    'mat4x4f',
  ].map(label => ({ label, type: 'type' })),
  { label: 'globals.time', type: 'property', detail: 'Elapsed seconds · f32' },
  {
    label: 'globals.resolution',
    type: 'property',
    detail: 'Canvas size · vec2f',
  },
  { label: 'controls', type: 'variable', detail: 'Live control values' },
])

const theme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: '#111315',
      color: '#d1d5dc',
      fontSize: '12px',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
      lineHeight: '1.6',
    },
    '.cm-content': { padding: '8px 0', caretColor: '#bbf4ce' },
    '.cm-line': { padding: '0 12px 0 8px' },
    '.cm-gutters': {
      backgroundColor: '#111315',
      color: '#4d535a',
      border: 'none',
      paddingRight: '4px',
      userSelect: 'none',
    },
    '.cm-lineNumbers .cm-gutterElement': { minWidth: '35px' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#191c1f' },
    '.cm-activeLineGutter': { color: '#89909a' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#bbf4ce' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      {
        backgroundColor: '#35453f',
      },
    '.cm-matchingBracket': { color: '#baf2c7', backgroundColor: '#35453f' },
    '.cm-tooltip': {
      backgroundColor: '#202428',
      border: '1px solid #363b40',
      color: '#d1d5dc',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: '#35453f',
      color: '#e1f8e8',
    },
    '.cm-panels': { backgroundColor: '#202428', color: '#d1d5dc' },
    '.cm-textfield': {
      backgroundColor: '#111315',
      border: '1px solid #444c51',
      color: '#d1d5dc',
    },
    '.cm-button': {
      background: '#2d3534',
      border: '1px solid #46544e',
      color: '#d1d5dc',
    },
    '.cm-searchMatch': { backgroundColor: '#79663555' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#ad8f4055' },
    '.cm-diagnostic': { fontFamily: 'inherit', padding: '5px 9px' },
    '.cm-diagnostic-error': { borderLeftColor: '#f18c8c' },
    '.cm-diagnostic-warning': { borderLeftColor: '#e8bf78' },
    '.cm-foldPlaceholder': {
      backgroundColor: '#252b29',
      border: 'none',
      color: '#91a89c',
    },
  },
  { dark: true },
)

const highlighting = HighlightStyle.define([
  { tag: tags.keyword, color: '#bc9fe8' },
  { tag: [tags.typeName, tags.className], color: '#9dd7bd' },
  { tag: [tags.number, tags.bool], color: '#e4ba84' },
  { tag: tags.comment, color: '#626e70', fontStyle: 'italic' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: '#9ec4e3',
  },
  { tag: tags.operator, color: '#a7b2bc' },
  { tag: tags.string, color: '#b8d596' },
  { tag: [tags.meta, tags.annotation], color: '#94aebe' },
])

const offsetAt = (state: EditorState, line: number, column: number) => {
  const documentLine = state.doc.line(
    Math.max(1, Math.min(state.doc.lines, line)),
  )
  return Math.min(documentLine.to, documentLine.from + Math.max(0, column - 1))
}

export const createEditor = (
  element: HTMLElement,
  source: string,
  onChange: (source: string) => void,
  onRender: () => void,
): ShaderEditor => {
  const editable = new Compartment()
  const view = new EditorView({
    parent: element,
    state: EditorState.create({
      doc: source,
      extensions: [
        basicSetup,
        wgsl(),
        wgslLanguage.data.of({ autocomplete: completions }),
        wgslLanguage.data.of({ autocomplete: completeAnyWord }),
        wgslLanguage.data.of({
          autocomplete: (context: CompletionContext) =>
            completeFromList(
              parseControls(context.state.doc.toString()).controls.map(
                control => ({
                  label: `controls.${control.name}`,
                  type: 'property',
                  detail: `${control.kind} · f32`,
                }),
              ),
            )(context),
        }),
        indentUnit.of('  '),
        theme,
        syntaxHighlighting(highlighting),
        lintGutter(),
        editable.of(EditorState.readOnly.of(false)),
        EditorView.contentAttributes.of({
          'aria-label': 'WGSL shader code',
          'aria-multiline': 'true',
          spellcheck: 'false',
          autocapitalize: 'off',
          autocorrect: 'off',
        }),
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-Enter',
              run: editor => {
                if (!editor.state.readOnly) {
                  onRender()
                }
                return true
              },
            },
            indentWithTab,
          ]),
        ),
        EditorView.updateListener.of(update => {
          if (
            update.docChanged &&
            !update.transactions.some(transaction =>
              transaction.annotation(reflectedSource),
            )
          ) {
            onChange(update.state.doc.toString())
          }
        }),
      ],
    }),
  })

  return {
    setSource: nextSource => {
      if (view.state.doc.toString() !== nextSource) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: nextSource },
          annotations: reflectedSource.of(true),
        })
      }
    },
    setDiagnostics: (diagnostics, source) => {
      if (view.state.doc.toString() !== source) {
        return
      }
      view.dispatch(
        setDiagnostics(
          view.state,
          diagnostics.map(diagnostic => {
            const from = offsetAt(
              view.state,
              diagnostic.line,
              diagnostic.column,
            )
            return {
              from,
              to: Math.min(view.state.doc.lineAt(from).to, from + 1),
              severity: diagnostic.severity,
              message: diagnostic.message,
              source: 'WGSL',
            }
          }),
        ),
      )
    },
    focusLine: (line, column) => {
      const anchor = offsetAt(view.state, line, column)
      view.dispatch({
        selection: { anchor },
        effects: EditorView.scrollIntoView(anchor, { y: 'center' }),
      })
      view.focus()
    },
    setReadOnly: readOnly => {
      if (view.state.readOnly !== readOnly) {
        view.dispatch({
          effects: editable.reconfigure([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
          ]),
        })
      }
    },
    dispose: () => view.destroy(),
  }
}
