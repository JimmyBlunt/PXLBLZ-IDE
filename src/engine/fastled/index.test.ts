import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileFastLed, createFastLedRuntime } from './index'

const artifact = { id: 'demo', moduleUrl: 'http://127.0.0.1:9981/builds/demo/module.mjs', fastledVersion: '3.10.4' }

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('FastLED compiler client', () => {
  it('passes source verbatim and preserves compiler diagnostics', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ diagnostics: 'Sketch.ino:3: unknown symbol' }), { status: 422 }))
    vi.stubGlobal('fetch', fetch)
    await expect(compileFastLed({ source: '#include <FastLED.h>\n', compilerUrl: 'http://127.0.0.1:9981' })).rejects.toThrow('Sketch.ino:3')
    expect(JSON.parse(fetch.mock.calls[0][1].body).source).toBe('#include <FastLED.h>\n')
  })
  it('rejects remote compiler and cross-origin executable artifact URLs', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...artifact, moduleUrl: 'https://example.com/code.js' })))
    vi.stubGlobal('fetch', fetch)
    await expect(compileFastLed({ source: 'void loop(){}', compilerUrl: 'https://example.com' })).rejects.toThrow('local FastLED compiler')
    expect(fetch).not.toHaveBeenCalled()
    await expect(compileFastLed({ source: 'void loop(){}', compilerUrl: 'http://127.0.0.1:9981' })).rejects.toThrow('outside its local service')
  })
  it('rejects malformed success responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('null')))
    await expect(compileFastLed({ source: 'void loop(){}', compilerUrl: 'http://127.0.0.1:9981' })).rejects.toThrow('invalid response')
  })
})

class FakeWorker {
  static instances: FakeWorker[] = []
  constructor() { FakeWorker.instances.push(this) }
  terminate = vi.fn()
  postMessage = vi.fn()
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  send(data: unknown) { this.onmessage?.({ data }) }
}

describe('FastLED worker ownership', () => {
  it('drops paused frames and terminates the old worker on reset and disposal', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    FakeWorker.instances = []
    const onFrame = vi.fn()
    const pending = createFastLedRuntime({ artifact, onFrame, onError: vi.fn() })
    const first = FakeWorker.instances[0]
    first.send({ type: 'ready' })
    const runtime = await pending
    runtime.start()
    first.send({ type: 'frame', frame: new Uint8Array([255, 0, 0]) })
    expect(onFrame).toHaveBeenCalledOnce()
    runtime.pause()
    first.send({ type: 'frame', frame: new Uint8Array([0, 0, 0]) })
    expect(onFrame).toHaveBeenCalledOnce()
    runtime.reset()
    expect(first.terminate).toHaveBeenCalledOnce()
    const second = FakeWorker.instances[1]
    runtime.start()
    second.send({ type: 'ready' })
    expect(second.postMessage).toHaveBeenCalledWith({ type: 'start' })
    first.send({ type: 'frame', frame: new Uint8Array([0, 0, 0]) })
    expect(onFrame).toHaveBeenCalledOnce()
    runtime.dispose()
    expect(second.terminate).toHaveBeenCalledOnce()
  })
  it('cancels an initialization even when the sketch never returns', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    FakeWorker.instances = []
    const controller = new AbortController()
    const pending = createFastLedRuntime({ artifact, onFrame: vi.fn(), onError: vi.fn(), signal: controller.signal })
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalled()
  })
  it('reports initialization timeout without leaving a worker alive', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', FakeWorker)
    FakeWorker.instances = []
    const onError = vi.fn()
    const pending = createFastLedRuntime({ artifact, onFrame: vi.fn(), onError })
    const rejected = expect(pending).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(30000)
    await rejected
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('timed out'))
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalled()
  })
})
