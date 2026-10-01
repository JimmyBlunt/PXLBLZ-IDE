import { copyFastLedFrame, type FastLedModule } from './frames'
import type { FastLedArtifact } from './index'

// A worker owns the entire C++ instance. A blocking delay or loop never runs on
// the editor thread; reset/dispose can terminate it without cooperation.
const scope = globalThis as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent) => void) | null
}
let module: FastLedModule | null = null
let running = false
let stepping = false
let timer: ReturnType<typeof setTimeout> | undefined
let callbackCount = 0
let lastSentAt = -Infinity

function sendFrame() {
  if (!module) return
  callbackCount++
  // Preserve blocking Blink-style intermediate shows while bounding transport
  // from sketches that call show thousands of times per loop. This is monitor
  // sampling only: no C++ state or clock is changed. Parity captures every show
  // independently of this display-rate limit.
  const now = performance.now()
  if (now - lastSentAt < 1000 / 120) return
  const frame = copyFastLedFrame(module)
  if (frame.length) {
    lastSentAt = now
    scope.postMessage({ type: 'frame', frame }, [frame.buffer])
  }
}

function fail(error: unknown) {
  running = false
  clearTimeout(timer)
  scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
}

async function tick() {
  if (!running || !module || stepping) return
  stepping = true
  try {
    const started = performance.now()
    const before = callbackCount
    await module._extern_loop()
    if (callbackCount === before) sendFrame()
    // Match the upstream 60 Hz preview cadence without adding another frame's
    // delay to sketches that already spend time in FastLED.delay()/delay().
    if (running) timer = setTimeout(() => void tick(), Math.max(0, 1000 / 60 - (performance.now() - started)))
  } catch (error) { fail(error) }
  finally { stepping = false }
}

async function load(artifact: FastLedArtifact) {
  const imported = await import(/* @vite-ignore */ artifact.moduleUrl) as {
    default: (options: Record<string, unknown>) => Promise<FastLedModule>
  }
  if (typeof imported.default !== 'function') throw new Error('FastLED compiler artifact has no module factory.')
  module = await imported.default({
    noInitialRun: true,
    locateFile: (file: string) => file.endsWith('.wasm') && artifact.wasmUrl
      ? artifact.wasmUrl : new URL(file, artifact.moduleUrl).href,
    pxlblzOnFrame: sendFrame,
    print: () => undefined,
    printErr: (message: string) => scope.postMessage({ type: 'log', message }),
  })
  await module._extern_setup()
  sendFrame()
  scope.postMessage({ type: 'ready' })
  if (running) void tick()
}

scope.onmessage = (event: MessageEvent<{ type: string; artifact?: FastLedArtifact }>) => {
  if (event.data.type === 'load' && event.data.artifact) void load(event.data.artifact).catch(fail)
  else if (event.data.type === 'start' && !running) { running = true; void tick() }
  else if (event.data.type === 'pause') { running = false; clearTimeout(timer) }
}
