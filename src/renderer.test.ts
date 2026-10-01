import { afterEach, expect, test, vi } from 'vitest'

import { buildShader } from './domain/shader'
import { createRenderer } from './renderer'

const source = 'fn fragment(uv: vec2f) -> vec4f { return vec4f(uv, 0.5, 1.0); }'

const fakeGPU = () => {
  let nextFrame: FrameRequestCallback = () => undefined
  const pass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  }
  const context = {
    configure: vi.fn(),
    unconfigure: vi.fn(),
    getCurrentTexture: () => ({ createView: () => ({}) }),
  }
  const device = {
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({
      getCompilationInfo: async (): Promise<{
        messages: ReadonlyArray<GPUCompilationMessage>
      }> => ({ messages: [] }),
    })),
    createRenderPipelineAsync: vi.fn(async () => ({ name: 'pipeline' })),
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn(async (): Promise<GPUError | null> => null),
    createCommandEncoder: () => ({
      beginRenderPass: () => pass,
      finish: () => ({}),
    }),
    queue: { writeBuffer: vi.fn(), submit: vi.fn() },
    limits: { maxTextureDimension2D: 4096 },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    destroy: vi.fn(),
    lost: new Promise<GPUDeviceLostInfo>(() => undefined),
  }
  vi.stubGlobal('navigator', {
    gpu: {
      requestAdapter: async () => ({ requestDevice: async () => device }),
      getPreferredCanvasFormat: () => 'bgra8unorm',
    },
  })
  vi.stubGlobal('GPUBufferUsage', { UNIFORM: 64, COPY_DST: 8 })
  vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextFrame = callback
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const canvas = document.createElement('canvas')
  Object.defineProperties(canvas, {
    getContext: { value: () => context },
    clientWidth: { value: 1280 },
    clientHeight: { value: 720 },
  })
  return { canvas, device, context, pass, draw: () => nextFrame(0) }
}

afterEach(() => vi.unstubAllGlobals())

test('syntax and pipeline errors never replace a running shader; validation does not render', async () => {
  const gpu = fakeGPU()
  const onFailure = vi.fn()
  const renderer = await createRenderer(gpu.canvas, onFailure)
  expect(await renderer.render(source, [], 0)).toEqual([])
  gpu.draw()
  const livePipeline = gpu.pass.setPipeline.mock.lastCall?.[0]

  gpu.device.createShaderModule.mockReturnValueOnce({
    getCompilationInfo: async () => {
      const diagnostic: GPUCompilationMessage = {
        __brand: 'GPUCompilationMessage',
        message: 'Unknown identifier: missing',
        type: 'error',
        lineNum: buildShader(source).lineOffset + 1,
        linePos: 4,
        offset: 0,
        length: 7,
      }
      return { messages: [diagnostic, diagnostic] }
    },
  })
  expect(await renderer.render(source, [], 0)).toMatchObject([
    { id: 'compiler:0:error:0', line: 1, column: 4, severity: 'error' },
    { id: 'compiler:0:error:1', line: 1, column: 4, severity: 'error' },
  ])
  gpu.draw()
  expect(gpu.pass.setPipeline.mock.lastCall?.[0]).toBe(livePipeline)

  gpu.device.createRenderPipelineAsync.mockRejectedValueOnce(
    new Error('Uniform binding mismatch'),
  )
  expect(await renderer.render(source, [], 0)).toMatchObject([
    { id: 'renderer:pipeline', message: 'Uniform binding mismatch' },
  ])
  gpu.draw()
  expect(gpu.pass.setPipeline.mock.lastCall?.[0]).toBe(livePipeline)

  expect(await renderer.validate(source)).toEqual([])
  gpu.draw()
  expect(gpu.pass.setPipeline.mock.lastCall?.[0]).toBe(livePipeline)
  expect(gpu.device.pushErrorScope).toHaveBeenCalledTimes(
    gpu.device.popErrorScope.mock.calls.length,
  )
  expect(onFailure).not.toHaveBeenCalled()
  renderer.dispose()
})

test('disposed renderers cannot commit a pending shader or report late device errors', async () => {
  const gpu = fakeGPU()
  const onFailure = vi.fn()
  const renderer = await createRenderer(gpu.canvas, onFailure)
  let finishCompile: () => void = () => undefined
  gpu.device.createRenderPipelineAsync.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishCompile = () => resolve({ name: 'late pipeline' })
      }),
  )
  const pending = renderer.render(source, [], 0)
  await vi.waitFor(() =>
    expect(gpu.device.createRenderPipelineAsync).toHaveBeenCalledOnce(),
  )
  renderer.dispose()
  finishCompile()
  expect(await pending).toMatchObject([
    {
      id: 'renderer:disposed',
      severity: 'error',
      message: 'The renderer has been disposed.',
    },
  ])
  const onDeviceError = gpu.device.addEventListener.mock.calls[0]?.[1]
  onDeviceError({
    preventDefault: vi.fn(),
    error: { message: 'Late device error' },
  })
  gpu.draw()
  expect(gpu.pass.draw).not.toHaveBeenCalled()
  expect(gpu.device.destroy).toHaveBeenCalledOnce()
  expect(onFailure).not.toHaveBeenCalled()
})

test('startup failures balance GPU error scopes and release the device', async () => {
  const gpu = fakeGPU()
  gpu.device.createBuffer.mockImplementationOnce(() => {
    throw new Error('Allocation failed')
  })
  await expect(createRenderer(gpu.canvas, vi.fn())).rejects.toThrow(
    'Allocation failed',
  )
  expect(gpu.device.pushErrorScope).toHaveBeenCalledTimes(3)
  expect(gpu.device.popErrorScope).toHaveBeenCalledTimes(3)
  expect(gpu.device.destroy).toHaveBeenCalledOnce()
})

test('the latest render wins and controls use their declared uniform slots', async () => {
  const gpu = fakeGPU()
  const renderer = await createRenderer(gpu.canvas, vi.fn())
  const controlled = `// @slider speed 0 10 2 0.1\n// @knob zoom 1 8 4 0.1\n${source}`
  const first = renderer.render(source, [], 0)
  const controls = buildShader(controlled).controls
  const second = renderer.render(controlled, controls, 0)
  expect(await first).toMatchObject([
    {
      id: 'renderer:superseded',
      severity: 'error',
      message: expect.stringContaining('superseded'),
    },
  ])
  expect(await second).toEqual([])
  const controlBuffer = gpu.device.queue.writeBuffer.mock.lastCall?.[2]
  expect(controlBuffer).toBeInstanceOf(Float32Array)
  expect(controlBuffer[0]).toBe(2)
  expect(controlBuffer[4]).toBe(4)
  renderer.dispose()
})
