import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileFastLed, createFastLedRuntime } from './index'
import { writeFastLedMailbox } from './mailbox'

const artifact = { id: 'demo', moduleUrl: 'http://127.0.0.1:9981/builds/demo/module.mjs', fastledVersion: '3.10.4' }

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('FastLED compiler client', () => {
  it('passes source verbatim and preserves compiler diagnostics', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ diagnostics: 'Sketch.ino:3: unknown symbol' }), { status: 422 }))
    vi.stubGlobal('fetch', fetch)
    await expect(compileFastLed({ source: '#include <FastLED.h>\n', files: { 'effect.h': 'void effect();' }, compilerUrl: 'http://127.0.0.1:9981' })).rejects.toThrow('Sketch.ino:3')
    expect(JSON.parse(fetch.mock.calls[0][1].body).source).toBe('#include <FastLED.h>\n')
    expect(JSON.parse(fetch.mock.calls[0][1].body).files).toEqual({ 'effect.h': 'void effect();' })
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
  it('validates and resolves the classic pthread bootstrap alongside the module', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...artifact, runtimeUrl: '/builds/demo/fastled.js' })))
    vi.stubGlobal('fetch', fetch)
    const result = await compileFastLed({ source: 'void loop(){}', compilerUrl: 'http://127.0.0.1:9981' })
    expect(result.runtimeUrl).toBe('http://127.0.0.1:9981/builds/demo/fastled.js')
    fetch.mockResolvedValue(new Response(JSON.stringify({ ...artifact, runtimeUrl: 'https://example.com/thread.js' })))
    await expect(compileFastLed({ source: 'void loop(){}', compilerUrl: 'http://127.0.0.1:9981' })).rejects.toThrow('outside its local service')
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
  it('allows long setup animations after module loading while retaining cancellation', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', FakeWorker)
    FakeWorker.instances = []
    const controller = new AbortController()
    const onFrame = vi.fn(), onError = vi.fn()
    const pending = createFastLedRuntime({ artifact, onFrame, onError, signal: controller.signal })
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    const worker = FakeWorker.instances[0]
    worker.send({ type: 'module-loaded' })
    await vi.advanceTimersByTimeAsync(60000)
    worker.send({ type: 'frame', frame: new Uint8Array([255, 0, 0]) })
    expect(onFrame).toHaveBeenCalledOnce()
    expect(worker.terminate).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    controller.abort()
    await rejected
    expect(worker.terminate).toHaveBeenCalled()
  })
  it('samples the latest shared frame and isolates polling across pause, reset and stale errors', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', FakeWorker)
    FakeWorker.instances = []
    const onFrame = vi.fn(), onError = vi.fn()
    const pending = createFastLedRuntime({ artifact, onFrame, onError })
    const first = FakeWorker.instances[0]
    first.send({ type: 'ready' })
    const runtime = await pending
    runtime.start()
    const mailbox = first.postMessage.mock.calls[0][0].mailbox as SharedArrayBuffer
    writeFastLedMailbox(mailbox, new Uint8Array([255, 0, 0]))
    writeFastLedMailbox(mailbox, new Uint8Array([0, 0, 255]))
    await vi.advanceTimersByTimeAsync(20)
    expect([...onFrame.mock.calls[0][0]]).toEqual([0, 0, 255])
    runtime.pause()
    writeFastLedMailbox(mailbox, new Uint8Array([0, 255, 0]))
    await vi.advanceTimersByTimeAsync(20)
    expect(onFrame).toHaveBeenCalledOnce()
    runtime.reset()
    const second = FakeWorker.instances[1]
    second.send({ type: 'ready' })
    runtime.start()
    first.onerror?.({ message: 'stale worker error' })
    writeFastLedMailbox(second.postMessage.mock.calls[0][0].mailbox, new Uint8Array([1, 2, 3]))
    await vi.advanceTimersByTimeAsync(20)
    expect([...onFrame.mock.calls[1][0]]).toEqual([1, 2, 3])
    expect(onError).not.toHaveBeenCalled()
    runtime.dispose()
    await vi.advanceTimersByTimeAsync(100)
    expect(onFrame).toHaveBeenCalledTimes(2)
  })
  it('shows setup animations before initialization returns', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    FakeWorker.instances = []
    const onFrame = vi.fn()
    const pending = createFastLedRuntime({ artifact, onFrame, onError: vi.fn() })
    const worker = FakeWorker.instances[0]
    const frame = new Uint8Array([255, 0, 0])
    worker.send({ type: 'frame', frame })
    expect(onFrame).toHaveBeenCalledWith(frame)
    worker.send({ type: 'ready' })
    const runtime = await pending
    runtime.dispose()
  })
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
