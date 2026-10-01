import { expect, test } from 'vitest'

import { diagnosticCount } from '@codemirror/lint'
import { EditorView } from '@codemirror/view'

import { createEditor } from './editor'

test('editor reflects model changes without feedback and reports only user edits', () => {
  const host = document.createElement('div')
  document.body.append(host)
  const changes: Array<string> = []
  const renders: Array<string> = []
  const editor = createEditor(
    host,
    'fn initial() {}',
    source => changes.push(source),
    () => renders.push('render'),
  )
  const content = host.querySelector<HTMLElement>('.cm-content')
  if (!content) {
    throw new Error('Expected an accessible editor content element')
  }
  const view = EditorView.findFromDOM(content)
  if (!view) {
    throw new Error('Expected a mounted CodeMirror editor')
  }

  try {
    editor.setSource('fn next() {}\n')
    expect(changes).toEqual([])
    expect(view.state.doc.toString()).toBe('fn next() {}\n')

    view.dispatch({ changes: { from: 3, to: 7, insert: 'edited' } })
    expect(changes).toEqual(['fn edited() {}\n'])

    editor.setDiagnostics(
      [
        {
          line: 1,
          column: 4,
          id: 'validation-error',
          severity: 'error',
          message: 'Test compiler diagnostic',
        },
      ],
      'fn edited() {}\n',
    )
    expect(diagnosticCount(view.state)).toBe(1)
    editor.focusLine(1, 4)
    expect(view.state.selection.main.head).toBe(3)

    content.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        bubbles: true,
      }),
    )
    expect(renders).toEqual(['render'])
    editor.setReadOnly(true)
    expect(view.state.readOnly).toBe(true)
    content.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        bubbles: true,
      }),
    )
    expect(renders).toEqual(['render'])
    editor.setReadOnly(false)
    expect(view.state.readOnly).toBe(false)

    editor.setDiagnostics([], 'fn initial() {}')
    expect(diagnosticCount(view.state)).toBe(1)
    expect(view.state.doc.toString()).toBe('fn edited() {}\n')
    editor.setDiagnostics([], 'fn edited() {}\n')
    expect(diagnosticCount(view.state)).toBe(0)
  } finally {
    editor.dispose()
    host.remove()
  }
})
