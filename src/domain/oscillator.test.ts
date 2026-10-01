import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { oscillatorLevel } from './oscillator'

describe('oscillator waveforms', () => {
  test.each([
    { waveform: 'sine', expected: [0, (1 - Math.SQRT1_2) / 2, 0.5, 1, 0.5, 0] },
    { waveform: 'triangle', expected: [0, 0.25, 0.5, 1, 0.5, 0] },
    { waveform: 'sawtooth', expected: [0, 0.125, 0.25, 0.5, 0.75, 0] },
    { waveform: 'square', expected: [0, 0, 0, 1, 1, 0] },
  ] satisfies ReadonlyArray<{
    waveform: 'sine' | 'triangle' | 'sawtooth' | 'square'
    expected: ReadonlyArray<number>
  }>)('$waveform follows its cycle and wraps', ({ waveform, expected }) => {
    const binding = {
      name: 'speed',
      waveform,
      period: 4,
      depth: 100,
      phase: 0,
      maybeColor: Option.none<number>(),
    }
    const sampleTimes = [0, 0.5, 1, 2, 3, 4]
    sampleTimes.forEach((seconds, index) => {
      expect(oscillatorLevel(binding, seconds)).toBeCloseTo(
        expected[index] ?? NaN,
      )
      expect(oscillatorLevel(binding, seconds + 400)).toBeCloseTo(
        expected[index] ?? NaN,
      )
    })
  })

  test('phase shifts a shared cycle without changing its period', () => {
    const binding = {
      name: 'speed',
      waveform: 'sine',
      period: 4,
      depth: 100,
      phase: 90,
      maybeColor: Option.none<number>(),
    } satisfies Parameters<typeof oscillatorLevel>[0]
    expect(oscillatorLevel(binding, 0)).toBeCloseTo(0.5)
    expect(oscillatorLevel(binding, 1)).toBeCloseTo(1)
    expect(oscillatorLevel(binding, 4)).toBeCloseTo(0.5)
  })
})
