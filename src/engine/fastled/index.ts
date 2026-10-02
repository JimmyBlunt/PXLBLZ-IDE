export { FASTLED_DEMOS } from './examples'
import { createFastLedMailbox, readFastLedMailbox } from './mailbox'

export interface FastLedArtifact {
  id: string
  moduleUrl: string
  runtimeUrl?: string
  wasmUrl?: string
  fastledVersion: string
  diagnostics?: string
}

export async function compileFastLed({ source, files, compilerUrl, signal }: {
  source: string; files?: Record<string, string>; compilerUrl: string; signal?: AbortSignal
}): Promise<FastLedArtifact> {
  const base = new URL(compilerUrl)
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
    || base.username || base.password) throw new Error('Use the local FastLED compiler at http://127.0.0.1:9982.')
  const response = await fetch(new URL('/compile', base), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, files, name: 'Sketch' }), signal,
  })
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object') throw new Error('The compiler returned an invalid response.')
  const result = data as Partial<FastLedArtifact> & { error?: string }
  if (!response.ok) throw new Error(result.diagnostics || result.error || `FastLED compilation failed (${response.status}).`)
  if (!result || typeof result.id !== 'string' || typeof result.moduleUrl !== 'string'
    || typeof result.fastledVersion !== 'string') throw new Error('The compiler returned an invalid build artifact.')
  const moduleUrl = new URL(result.moduleUrl, base)
  const wasmUrl = result.wasmUrl ? new URL(result.wasmUrl, base) : undefined
  const runtimeUrl = result.runtimeUrl ? new URL(result.runtimeUrl, base) : undefined
  if (moduleUrl.origin !== base.origin || (wasmUrl && wasmUrl.origin !== base.origin)
    || (runtimeUrl && runtimeUrl.origin !== base.origin)) {
    throw new Error('The compiler returned an artifact outside its local service.')
  }
  return { id: result.id, moduleUrl: moduleUrl.href, runtimeUrl: runtimeUrl?.href, wasmUrl: wasmUrl?.href,
    fastledVersion: result.fastledVersion, diagnostics: result.diagnostics }
}

export interface FastLedRuntime {
  start(): void
  pause(): void
  reset(): void
  dispose(): void
}

export async function createFastLedRuntime({ artifact, onFrame, onError, onLayout, signal }: {
  artifact: FastLedArtifact
  onFrame: (frame: Uint8Array) => void
  onError: (message: string) => void
  onLayout?: (positions: [number, number][]) => void
  signal?: AbortSignal
}): Promise<FastLedRuntime> {
  let worker: Worker | null = null
  let disposed = false
  let playing = false
  let generation = 0
  let cancelLaunch: (() => void) | undefined
  let stopPolling = () => {}
  const dispose = () => {
    disposed = true
    playing = false
    generation++
    cancelLaunch?.()
    stopPolling()
    worker?.terminate()
    worker = null
    signal?.removeEventListener('abort', dispose)
  }
  if (signal?.aborted) throw new DOMException('FastLED initialization cancelled.', 'AbortError')
  signal?.addEventListener('abort', dispose, { once: true })
  const launch = () => new Promise<void>((resolve, reject) => {
    cancelLaunch?.()
    stopPolling()
    const current = ++generation
    worker?.terminate()
    const next = new Worker(new URL('./runtime.worker.ts', import.meta.url), { type: 'module' })
    worker = next
    let ready = false
    let stopThisPolling = () => {}
    const cancel = () => {
      clearTimeout(timeout)
      stopThisPolling()
      next.terminate()
      reject(new DOMException('FastLED initialization cancelled.', 'AbortError'))
    }
    cancelLaunch = cancel
    const timeout = setTimeout(() => {
      fail('FastLED initialization timed out. Reset the sketch to try again.')
    }, 30000)
    const fail = (message: string) => {
      if (disposed || current !== generation) return
      clearTimeout(timeout)
      stopThisPolling()
      next.terminate()
      reject(new Error(message))
      if (!disposed && current === generation) onError(message)
    }
    next.onerror = (event) => fail(event.message || 'FastLED worker failed.')
    next.onmessage = (event: MessageEvent<{ type: string; frame?: Uint8Array; positions?: [number, number][]; message?: string }>) => {
      if (disposed || current !== generation) return
      if (event.data.type === 'module-loaded') {
        clearTimeout(timeout)
      } else if (event.data.type === 'ready') {
        ready = true
        cancelLaunch = undefined
        clearTimeout(timeout)
        resolve()
        if (playing) next.postMessage({ type: 'start' })
      // setup() may itself animate LEDs before returning. Deliver those frames
      // during initialization too; once ready, playback controls own delivery.
      } else if (event.data.type === 'frame' && event.data.frame && (!ready || playing)) onFrame(event.data.frame)
      else if (event.data.type === 'layout' && event.data.positions && (!ready || playing)) onLayout?.(event.data.positions)
      else if (event.data.type === 'error') fail(event.data.message || 'FastLED execution failed.')
    }
    // A bounded mailbox keeps the most recent show visible even while the C++
    // worker is blocked in delay(), without a queue of thousands of messages.
    const mailbox = typeof SharedArrayBuffer === 'undefined' ? undefined : createFastLedMailbox()
    if (mailbox) {
      let sequence = 0
      let layoutVersion = -1
      const poll = setInterval(() => {
        if (disposed || current !== generation || (ready && !playing)) return
        try {
          const result = readFastLedMailbox(mailbox, sequence, layoutVersion)
          if (result) {
            sequence = result.sequence
            layoutVersion = result.layoutVersion
            if (result.positions) onLayout?.(result.positions)
            onFrame(result.frame)
          }
        } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
      }, 1000 / 60)
      stopThisPolling = () => clearInterval(poll)
      stopPolling = stopThisPolling
    }
    next.postMessage({ type: 'load', artifact, mailbox })
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
