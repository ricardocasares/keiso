import { describe, expect, test } from 'vitest'

import { shaderExamples } from '../examples'
import { MAX_CONTROLS, buildShader, parseControls } from './shader'

describe('shader controls', () => {
  test('parses ordered controls, decimal exponents, and Unicode WGSL names', () => {
    expect(
      parseControls('// @slider speed 0 3 1 1e-2\n// @knob lumière -1 1 .5 .1'),
    ).toStrictEqual({
      controls: [
        { name: 'speed', kind: 'slider', min: 0, max: 3, value: 1, step: 0.01 },
        {
          name: 'lumière',
          kind: 'knob',
          min: -1,
          max: 1,
          value: 0.5,
          step: 0.1,
        },
      ],
      diagnostics: [],
    })
  })

  test.each([
    '// @slider speed 0 3 1',
    '// @slider speed 0 3 1 .1 extra',
    '// @slider 2speed 0 3 1 .1',
    '// @slider __speed 0 3 1 .1',
    '// @slider _ 0 3 1 .1',
    '// @slider globals 0 3 1 .1',
    '// @slider var 0 3 1 .1',
    '// @slider class 0 3 1 .1',
    '// @slider speed 0 Infinity 1 .1',
    '// @slider speed 0 1e40 1 .1',
    '// @slider speed 0 3 NaN .1',
    '// @slider speed 0 0x3 1 .1',
    '// @slider speed 3 0 1 .1',
    '// @slider speed 3 3 3 .1',
    '// @slider speed 0 3 4 .1',
    '// @slider speed 0 3 1 0',
    '// @slider speed 0 3 1 -1',
    '// @slider speed 0 3 1 4',
    '// @slider speed 0 3 1 1e-99',
  ])('rejects malformed annotation: %s', source => {
    const parsed = parseControls(`\n  ${source}`)
    expect(parsed.controls).toStrictEqual([])
    expect(parsed.diagnostics).toHaveLength(1)
    expect(parsed.diagnostics[0]).toMatchObject({
      line: 2,
      column: 6,
      severity: 'error',
    })
  })

  test('rejects duplicate names and limits the uniform layout', () => {
    const duplicate = parseControls(
      '// @slider speed 0 3 1 .1\n// @knob speed 0 3 2 .1',
    )
    expect(duplicate.controls).toHaveLength(1)
    expect(duplicate.diagnostics[0]?.line).toBe(2)
    const source = globalThis.Array.from(
      { length: MAX_CONTROLS + 1 },
      (_, index) => `// @slider control${index} 0 3 1 .1`,
    ).join('\n')
    const overflow = parseControls(source)
    expect(overflow.controls).toHaveLength(MAX_CONTROLS)
    expect(overflow.diagnostics).toHaveLength(1)
  })

  test('ignores nested block-comment annotations without opening blocks inside line comments', () => {
    const parsed = parseControls(`/*
// @slider speed 0 3 2 .1
/* nested
// @knob hidden 0 1 .5 .1
*/
// @slider malformed
*/
// This ordinary line comment contains /* and does not open a block.
// @slider speed 0 3 1 .1`)
    expect(parsed.controls).toStrictEqual([
      { name: 'speed', kind: 'slider', min: 0, max: 3, value: 1, step: 0.1 },
    ])
    expect(parsed.diagnostics).toStrictEqual([])
  })

  test('retains diagnostic positions after block comments and treats // inside blocks as ordinary text', () => {
    const parsed = parseControls(`/*
// /* nested */
// */
  // @slider speed 0 1 2 .1`)
    expect(parsed.controls).toStrictEqual([])
    expect(parsed.diagnostics).toHaveLength(1)
    expect(parsed.diagnostics[0]).toMatchObject({
      line: 4,
      column: 6,
      severity: 'error',
    })
  })

  test('maps user line numbers exactly and pads control fields to 16 bytes', () => {
    const source =
      '// @knob speed 0 3 1 .1\nfn fragment(uv: vec2f) -> vec4f {\n  return vec4f(uv, 0.0, 1.0);\n}'
    const shader = buildShader(source)
    expect(
      shader.code
        .split('\n')
        .slice(shader.lineOffset, shader.lineOffset + 4)
        .join('\n'),
    ).toBe(source)
    expect(shader.code).toContain('@align(16) speed: f32,')
    expect(shader.code).toContain(
      'return fragment(position.xy / globals.resolution)',
    )
    expect(buildShader('').code).toContain('@align(16) _unused: f32,')
  })

  test('all catalog examples have valid controls and the same fragment contract', () => {
    shaderExamples.forEach(example => {
      expect(buildShader(example.source).diagnostics).toStrictEqual([])
      expect(example.source).toContain('fn fragment(uv: vec2f) -> vec4f')
    })
  })
})
