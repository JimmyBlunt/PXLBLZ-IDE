export { FASTLED_DEMOS } from './examples'

export interface FastLedArtifact {
  id: string
  moduleUrl: string
  wasmUrl?: string
  fastledVersion: string
  diagnostics?: string
}

export async function compileFastLed({ source, compilerUrl, signal }: {
  source: string; compilerUrl: string; signal?: AbortSignal
}): Promise<FastLedArtifact> {
  const base = new URL(compilerUrl)
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
    || base.username || base.password) throw new Error('Use the local FastLED compiler at http://127.0.0.1:9982.')
  const response = await fetch(new URL('/compile', base), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, name: 'Sketch' }), signal,
  })
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object') throw new Error('The compiler returned an invalid response.')
  const result = data as Partial<FastLedArtifact> & { error?: string }
  if (!response.ok) throw new Error(result.diagnostics || result.error || `FastLED compilation failed (${response.status}).`)
  if (!result || typeof result.id !== 'string' || typeof result.moduleUrl !== 'string'
    || typeof result.fastledVersion !== 'string') throw new Error('The compiler returned an invalid build artifact.')
  const moduleUrl = new URL(result.moduleUrl, base)
  const wasmUrl = result.wasmUrl ? new URL(result.wasmUrl, base) : undefined
  if (moduleUrl.origin !== base.origin || (wasmUrl && wasmUrl.origin !== base.origin)) {
    throw new Error('The compiler returned an artifact outside its local service.')
  }
  return { id: result.id, moduleUrl: moduleUrl.href, wasmUrl: wasmUrl?.href,
    fastledVersion: result.fastledVersion, diagnostics: result.diagnostics }
}

export interface FastLedRuntime {
  start(): void
  pause(): void
  reset(): void
  dispose(): void
}

export async function createFastLedRuntime({ artifact, onFrame, onError, signal }: {
  artifact: FastLedArtifact
  onFrame: (frame: Uint8Array) => void
  onError: (message: string) => void
  signal?: AbortSignal
}): Promise<FastLedRuntime> {
  let worker: Worker | null = null
  let disposed = false
  let playing = false
  let generation = 0
  let cancelLaunch: (() => void) | undefined
  const dispose = () => {
    disposed = true
    playing = false
    generation++
    cancelLaunch?.()
    worker?.terminate()
    worker = null
    signal?.removeEventListener('abort', dispose)
  }
  if (signal?.aborted) throw new DOMException('FastLED initialization cancelled.', 'AbortError')
  signal?.addEventListener('abort', dispose, { once: true })
  const launch = () => new Promise<void>((resolve, reject) => {
    cancelLaunch?.()
    const current = ++generation
    worker?.terminate()
    const next = new Worker(new URL('./runtime.worker.ts', import.meta.url), { type: 'module' })
    worker = next
    let ready = false
    const cancel = () => {
      clearTimeout(timeout)
      next.terminate()
      reject(new DOMException('FastLED initialization cancelled.', 'AbortError'))
    }
    cancelLaunch = cancel
    const timeout = setTimeout(() => {
      fail('FastLED initialization timed out. Reset the sketch to try again.')
    }, 30000)
    const fail = (message: string) => {
      clearTimeout(timeout)
      next.terminate()
      reject(new Error(message))
      if (!disposed && current === generation) onError(message)
    }
    next.onerror = (event) => fail(event.message || 'FastLED worker failed.')
    next.onmessage = (event: MessageEvent<{ type: string; frame?: Uint8Array; message?: string }>) => {
      if (disposed || current !== generation) return
      if (event.data.type === 'ready') {
        ready = true
        cancelLaunch = undefined
        clearTimeout(timeout)
        resolve()
        if (playing) next.postMessage({ type: 'start' })
      } else if (event.data.type === 'frame' && event.data.frame && playing && ready) onFrame(event.data.frame)
      else if (event.data.type === 'error') fail(event.data.message || 'FastLED execution failed.')
    }
    next.postMessage({ type: 'load', artifact })
  })
  try { await launch() } catch (error) { dispose(); throw error }
  return {
    start() { if (!disposed) { playing = true; worker?.postMessage({ type: 'start' }) } },
    pause() { playing = false; worker?.postMessage({ type: 'pause' }) },
    reset() {
      if (!disposed) void launch().catch((error: unknown) => {
        if (!disposed && !(error instanceof DOMException && error.name === 'AbortError')) {
          onError(error instanceof Error ? error.message : String(error))
        }
      })
    },
    dispose,
  }
}
