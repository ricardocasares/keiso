import { Option } from 'effect'

import {
  type Diagnostic,
  MAX_CONTROLS,
  type ShaderControl,
  buildShader,
} from './domain/shader'

const failure = (
  kind: 'pipeline' | 'disposed' | 'superseded',
  message: string,
): Diagnostic => ({
  id: `renderer:${kind}`,
  line: 1,
  column: 1,
  severity: 'error',
  message,
})

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

type LiveShader = {
  readonly pipeline: GPURenderPipeline
  readonly controls: ReadonlyArray<ShaderControl>
  readonly startedAt: number
}

export const createRenderer = async (
  canvas: HTMLCanvasElement,
  onFailure: (reason: string) => void,
) => {
  const gpu = navigator.gpu
  if (!gpu) {
    throw new Error(
      'WebGPU is unavailable. Use a WebGPU browser over HTTPS or localhost.',
    )
  }
  const adapter = await gpu.requestAdapter({
    powerPreference: 'high-performance',
  })
  if (!adapter) {
    throw new Error('No WebGPU adapter is available on this device.')
  }
  const device = await adapter.requestDevice()
  const context = canvas.getContext('webgpu')
  if (!context) {
    device.destroy()
    throw new Error('Unable to create a WebGPU canvas.')
  }

  const errorFilters: ReadonlyArray<GPUErrorFilter> = [
    'internal',
    'out-of-memory',
    'validation',
  ]
  const withErrorScopes = async <Value>(
    operation: () => Value | Promise<Value>,
  ): Promise<Value> => {
    errorFilters.forEach(filter => device.pushErrorScope(filter))
    try {
      return await operation()
    } finally {
      const errors = await Promise.all(
        errorFilters.map(() =>
          device.popErrorScope().catch(error => new Error(errorMessage(error))),
        ),
      )
      const error = errors.find(error => error !== null)
      if (error) {
        throw new Error(error.message)
      }
    }
  }

  try {
    const format = gpu.getPreferredCanvasFormat()
    const { globalsBuffer, controlsBuffer, pipelineLayout, bindGroup } =
      await withErrorScopes(() => {
        const globalsBuffer = device.createBuffer({
          label: 'Shader clock and resolution',
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })
        const controlsBuffer = device.createBuffer({
          label: 'Shader controls',
          size: MAX_CONTROLS * 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })
        const bindGroupLayout = device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform', minBindingSize: 16 },
            },
            {
              binding: 1,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform', minBindingSize: MAX_CONTROLS * 16 },
            },
          ],
        })
        const pipelineLayout = device.createPipelineLayout({
          bindGroupLayouts: [bindGroupLayout],
        })
        const bindGroup = device.createBindGroup({
          layout: bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: globalsBuffer } },
            { binding: 1, resource: { buffer: controlsBuffer } },
          ],
        })
        context.configure({ device, format, alphaMode: 'opaque' })
        return { globalsBuffer, controlsBuffer, pipelineLayout, bindGroup }
      })

    let disposed = false
    let frame = 0
    let renderVersion = 0
    let compilation = Promise.resolve()
    let live: Option.Option<LiveShader> = Option.none()
    const globals = new Float32Array(4)
    const controlValues = new Float32Array(MAX_CONTROLS * 4)

    const dispose = () => {
      if (disposed) {
        return
      }
      disposed = true
      cancelAnimationFrame(frame)
      device.removeEventListener('uncapturederror', onUncapturedError)
      globalsBuffer.destroy()
      controlsBuffer.destroy()
      context.unconfigure()
      device.destroy()
    }

    const reportFailure = (reason: string) => {
      if (!disposed) {
        dispose()
        onFailure(reason)
      }
    }

    const onUncapturedError = (event: GPUUncapturedErrorEvent) => {
      event.preventDefault()
      reportFailure(event.error.message)
    }
    device.addEventListener('uncapturederror', onUncapturedError)
    void device.lost.then(info =>
      reportFailure(`GPU device lost: ${info.message || info.reason}`),
    )

    const uploadControls = (
      definitions: ReadonlyArray<ShaderControl>,
      controls: ReadonlyArray<ShaderControl>,
    ) => {
      controlValues.fill(0)
      definitions.forEach((definition, index) => {
        const value =
          controls.find(control => control.name === definition.name)?.value ??
          definition.value
        const bounded = Number.isFinite(value)
          ? Math.min(definition.max, Math.max(definition.min, value))
          : definition.value
        if (definition.kind === 'color') {
          const rgb = Math.round(bounded)
          controlValues.set(
            [
              ((rgb >> 16) & 255) / 255,
              ((rgb >> 8) & 255) / 255,
              (rgb & 255) / 255,
            ],
            index * 4,
          )
        } else {
          controlValues[index * 4] = bounded
        }
      })
      device.queue.writeBuffer(controlsBuffer, 0, controlValues)
    }

    const setControls = (controls: ReadonlyArray<ShaderControl>) => {
      if (!disposed && Option.isSome(live)) {
        uploadControls(live.value.controls, controls)
      }
    }

    const draw = (timestamp: number) => {
      if (disposed || Option.isNone(live)) {
        return
      }
      try {
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        const width = Math.max(1, Math.floor(canvas.clientWidth * ratio))
        const height = Math.max(1, Math.floor(canvas.clientHeight * ratio))
        const scale = Math.min(
          1,
          device.limits.maxTextureDimension2D / Math.max(width, height),
        )
        const pixelWidth = Math.max(1, Math.floor(width * scale))
        const pixelHeight = Math.max(1, Math.floor(height * scale))
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
          canvas.width = pixelWidth
          canvas.height = pixelHeight
        }
        globals[0] = pixelWidth
        globals[1] = pixelHeight
        globals[2] =
          (performance.timeOrigin + timestamp - live.value.startedAt) / 1000
        device.queue.writeBuffer(globalsBuffer, 0, globals)
        const encoder = device.createCommandEncoder()
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        })
        pass.setPipeline(live.value.pipeline)
        pass.setBindGroup(0, bindGroup)
        pass.draw(3)
        pass.end()
        device.queue.submit([encoder.finish()])
        frame = requestAnimationFrame(draw)
      } catch (error) {
        reportFailure(errorMessage(error))
      }
    }

    const compile = async (source: string) => {
      const shader = buildShader(source)
      const diagnostics: Array<Diagnostic> = [...shader.diagnostics]
      let pipeline: Option.Option<GPURenderPipeline> = Option.none()
      if (disposed) {
        diagnostics.push(failure('disposed', 'The renderer has been disposed.'))
      }
      if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
        return { diagnostics, pipeline, controls: shader.controls }
      }

      try {
        pipeline = await withErrorScopes(async () => {
          const module = device.createShaderModule({ code: shader.code })
          const information = await module.getCompilationInfo()
          const sourceLines = source.split('\n').length
          const occurrences = new Map<string, number>()
          information.messages.forEach(message => {
            const identity = `compiler:${message.offset}:${message.type}`
            const occurrence = occurrences.get(identity) ?? 0
            occurrences.set(identity, occurrence + 1)
            diagnostics.push({
              id: `${identity}:${occurrence}`,
              line: Math.max(
                1,
                Math.min(sourceLines, message.lineNum - shader.lineOffset),
              ),
              column: Math.max(1, message.linePos),
              severity: message.type,
              message: message.message,
            })
          })
          if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
            return Option.none()
          }
          return Option.some(
            await device.createRenderPipelineAsync({
              layout: pipelineLayout,
              vertex: { module, entryPoint: 'vertex_main' },
              fragment: {
                module,
                entryPoint: 'fragment_main',
                targets: [{ format }],
              },
              primitive: { topology: 'triangle-list' },
            }),
          )
        })
      } catch (error) {
        diagnostics.push(failure('pipeline', errorMessage(error)))
      }
      if (disposed) {
        diagnostics.push(failure('disposed', 'The renderer has been disposed.'))
      }
      return { diagnostics, pipeline, controls: shader.controls }
    }

    const enqueue = <Value>(
      operation: () => Promise<Value>,
    ): Promise<Value> => {
      const pending = compilation.then(operation)
      compilation = pending.then(
        () => undefined,
        () => undefined,
      )
      return pending
    }

    const validate = (source: string): Promise<ReadonlyArray<Diagnostic>> =>
      enqueue(async () => (await compile(source)).diagnostics)

    const render = (
      source: string,
      controls: ReadonlyArray<ShaderControl>,
      startedAt: number,
    ): Promise<ReadonlyArray<Diagnostic>> => {
      const version = ++renderVersion
      return enqueue(async () => {
        const result = await compile(source)
        if (version !== renderVersion) {
          return [
            failure(
              'superseded',
              'A newer render request superseded this render.',
            ),
          ]
        }
        if (
          !result.diagnostics.some(
            diagnostic => diagnostic.severity === 'error',
          ) &&
          Option.isSome(result.pipeline)
        ) {
          const wasIdle = Option.isNone(live)
          uploadControls(result.controls, controls)
          live = Option.some({
            pipeline: result.pipeline.value,
            controls: result.controls,
            startedAt,
          })
          if (wasIdle) {
            frame = requestAnimationFrame(draw)
          }
        }
        return result.diagnostics
      })
    }

    return { validate, render, setControls, dispose }
  } catch (error) {
    context.unconfigure()
    device.destroy()
    throw error
  }
}

export type Renderer = Awaited<ReturnType<typeof createRenderer>>
