import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

import { buildShader } from './shader'

test('music ribbons fits the host controls and starts with silent audio inputs', () => {
  const source = readFileSync('shaders/music-ribbons.wgsl', 'utf8')
  const shader = buildShader(source)
  expect(shader.diagnostics).toEqual([])
  expect(shader.controls).toHaveLength(16)
  expect(
    new Set([...source.matchAll(/controls\.(\w+)/g)].map(match => match[1])),
  ).toEqual(new Set(shader.controls.map(control => control.name)))
  ;['bass', 'mids', 'highs'].forEach(name => {
    expect(
      shader.controls.find(control => control.name === name),
    ).toMatchObject({ min: 0, max: 1, value: 0 })
  })
})
