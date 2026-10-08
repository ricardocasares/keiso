import { Array, BigDecimal, Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'

export const ShaderControl = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(['slider', 'color']),
  min: Schema.Number,
  max: Schema.Number,
  step: Schema.Number,
  value: Schema.Number,
})
export type ShaderControl = typeof ShaderControl.Type

export const Diagnostic = Schema.Struct({
  id: Schema.String,
  line: Schema.Number,
  column: Schema.Number,
  severity: Schema.Literals(['error', 'warning', 'info']),
  message: Schema.String,
})
export type Diagnostic = typeof Diagnostic.Type

export const MAX_CONTROLS = 16

export const WGSL_RESERVED_IDENTIFIERS = `alias break case const const_assert continue continuing default diagnostic
  discard else enable false fn for if let loop override requires return struct
  switch true var while NULL Self abstract active alignas alignof as asm
  asm_fragment async attribute auto await become cast catch class co_await
  co_return co_yield coherent column_major common compile compile_fragment
  concept const_cast consteval constexpr constinit crate debugger decltype
  delete demote demote_to_helper do dynamic_cast enum explicit export extends
  extern external fallthrough filter final finally friend from fxgroup get goto
  groupshared highp impl implements import inline instanceof interface layout
  lowp macro macro_rules match mediump meta mod module move mut mutable namespace
  new nil noexcept noinline nointerpolation non_coherent noncoherent
  noperspective null nullptr of operator package packoffset partition pass patch
  pixelfragment precise precision premerge priv protected pub public readonly
  ref regardless register reinterpret_cast require resource restrict self set
  shared sizeof smooth snorm static static_assert static_cast std subroutine
  super target template this thread_local throw trait try type typedef typeid
  typename typeof union unless unorm unsafe unsized use using varying virtual
  volatile wgsl where with writeonly yield`

const reservedNames = new Set(
  `globals controls Globals Controls vertex_main fragment_main ${WGSL_RESERVED_IDENTIFIERS}`.split(
    /\s+/,
  ),
)

const identifier = /^[_\p{XID_Start}][\p{XID_Continue}]*$/u
const decimal = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

type ParsedControls = {
  readonly controls: ReadonlyArray<ShaderControl>
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

const maskBlockComments = (source: string): string =>
  Array.fromIterable(
    source.matchAll(/\/\/|\/\*|\*\/|[\r\n]|[^/*\r\n]+|[/*]/g),
  ).reduce(
    (state, [token = '']) => {
      if (token === '\n' || token === '\r') {
        return {
          depth: state.depth,
          isLineComment: false,
          text: state.text + token,
        }
      }
      if (state.isLineComment) {
        return {
          depth: state.depth,
          isLineComment: true,
          text: state.text + token,
        }
      }
      const depth =
        token === '/*'
          ? state.depth + 1
          : token === '*/'
            ? Math.max(0, state.depth - 1)
            : state.depth
      const isHidden = state.depth > 0 || token === '/*'
      return {
        depth,
        isLineComment: state.depth === 0 && token === '//',
        text: state.text + (isHidden ? ' '.repeat(token.length) : token),
      }
    },
    { depth: 0, isLineComment: false, text: '' },
  ).text

export const parseControls = (source: string): ParsedControls =>
  maskBlockComments(source)
    .split(/\r?\n/)
    .reduce<ParsedControls>(
      (result, line, index) => {
        const annotation = line.match(/^\s*\/\/\s*@(slider|color)\b(.*)$/)
        if (!annotation) {
          return result
        }

        const kind = annotation[1]
        const fields = (annotation[2] ?? '').trim().split(/\s+/)
        const [
          name = '',
          minText = '',
          maxText = '',
          valueText = '',
          stepText = '',
        ] = fields
        const fail = (message: string): ParsedControls => ({
          controls: result.controls,
          diagnostics: result.diagnostics.concat({
            id: `control:${index + 1}:${kind}`,
            line: index + 1,
            column: line.indexOf('@') + 1,
            severity: 'error',
            message,
          }),
        })

        if (kind !== 'slider' && kind !== 'color') {
          return result
        }
        if (fields.length !== (kind === 'color' ? 2 : 5)) {
          return fail(
            'Use // @slider name min max default step or // @color name #RRGGBB.',
          )
        }
        if (
          !identifier.test(name) ||
          name === '_' ||
          name.startsWith('__') ||
          reservedNames.has(name)
        ) {
          return fail(`“${name}” is not an available WGSL control name.`)
        }
        if (result.controls.some(control => control.name === name)) {
          return fail(`Control “${name}” is already declared.`)
        }
        if (result.controls.length >= MAX_CONTROLS) {
          return fail(`A shader can have at most ${MAX_CONTROLS} controls.`)
        }
        if (kind === 'color') {
          if (!/^#[0-9a-f]{6}$/i.test(minText)) {
            return fail(
              `Color “${name}” needs a six-digit hex value like #AABBCC.`,
            )
          }
          return {
            controls: result.controls.concat({
              name,
              kind,
              min: 0,
              max: 0xffffff,
              step: 1,
              value: Number.parseInt(minText.slice(1), 16),
            }),
            diagnostics: result.diagnostics,
          }
        }
        if (
          ![minText, maxText, valueText, stepText].every(
            text =>
              decimal.test(text) && Number.isFinite(Math.fround(Number(text))),
          )
        ) {
          return fail(
            `Control “${name}” needs finite decimal numbers representable as f32.`,
          )
        }

        const min = Number(minText)
        const max = Number(maxText)
        const value = Number(valueText)
        const step = Number(stepText)
        if (
          min >= max ||
          value < min ||
          value > max ||
          step <= 0 ||
          step > max - min ||
          Math.fround(step) === 0
        ) {
          return fail(
            `Control “${name}” needs min < max, a default in range, and a positive step no larger than the range.`,
          )
        }

        return {
          controls: result.controls.concat({
            name,
            kind,
            min,
            max,
            value,
            step,
          }),
          diagnostics: result.diagnostics,
        }
      },
      { controls: [], diagnostics: [] },
    )

export const normalizeControlValue = (
  control: ShaderControl,
  value: number,
): number => {
  const min = BigDecimal.fromNumberUnsafe(control.min)
  const max = BigDecimal.fromNumberUnsafe(control.max)
  const step = BigDecimal.fromNumberUnsafe(control.step)
  const offset = BigDecimal.subtract(
    BigDecimal.fromNumberUnsafe(
      Math.min(control.max, Math.max(control.min, value)),
    ),
    min,
  )
  const remainder = BigDecimal.remainderUnsafe(offset, step)
  const lower = BigDecimal.sum(min, BigDecimal.subtract(offset, remainder))
  const upper = BigDecimal.sum(lower, step)
  return BigDecimal.toNumberUnsafe(
    BigDecimal.isLessThan(remainder, BigDecimal.subtract(step, remainder)) ||
      BigDecimal.isGreaterThan(upper, max)
      ? lower
      : upper,
  )
}

export const reconcileControls = (
  controls: ReadonlyArray<ShaderControl>,
  previousDefinitions: ReadonlyArray<ShaderControl>,
  previousValues: ReadonlyArray<ShaderControl>,
): ReadonlyArray<ShaderControl> =>
  controls.map(control => {
    const definition = previousDefinitions.find(
      previous => previous.name === control.name,
    )
    const previous = previousValues.find(
      previous => previous.name === control.name,
    )
    if (
      !definition ||
      !previous ||
      definition.kind !== control.kind ||
      previous.kind !== control.kind ||
      definition.value !== control.value
    ) {
      return control
    }
    return modifyFields(control, {
      value: () =>
        definition.min === control.min &&
        definition.max === control.max &&
        definition.step === control.step
          ? previous.value
          : normalizeControlValue(control, previous.value),
    })
  })

export const buildShader = (source: string) => {
  const parsed = parseControls(source)
  const fields = Array.match(parsed.controls, {
    onEmpty: () => '  @align(16) _unused: f32,',
    onNonEmpty: controls =>
      controls
        .map(
          control =>
            `  @align(16) ${control.name}: ${control.kind === 'color' ? 'vec3f' : 'f32'},`,
        )
        .join('\n'),
  })
  const header = `struct Globals {
  resolution: vec2f,
  time: f32,
  _padding: f32,
}
@group(0) @binding(0) var<uniform> globals: Globals;

struct Controls {
${fields}
}
@group(0) @binding(1) var<uniform> controls: Controls;

@vertex
fn vertex_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let x = f32((index << 1u) & 2u);
  let y = f32(index & 2u);
  return vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
}

`
  const footer = `

@fragment
fn fragment_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  return fragment(position.xy / globals.resolution);
}
`

  return {
    code: header + source + footer,
    lineOffset: header.split('\n').length - 1,
    controls: parsed.controls,
    diagnostics: parsed.diagnostics,
  }
}
