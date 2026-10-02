import { copyFastLedFrame, copyFastLedLayout, type FastLedModule } from './frames'
import type { FastLedArtifact } from './index'
import { writeFastLedMailbox } from './mailbox'

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
let mailbox: SharedArrayBuffer | undefined
let lastLayout = ''

function sendFrame() {
  if (!module) return
  callbackCount++
  const frame = copyFastLedFrame(module)
  if (frame.length) {
    // Always retain the final show before a blocking delay. Sampling here would
    // lose that persistent color; posting every frame would grow an unbounded
    // queue. The UI samples this single shared slot independently of C++.
    const positions = copyFastLedLayout(module, frame.length / 3)
    const layout = JSON.stringify(positions)
    // RGB and geometry share one sequence, including dynamic maps. A pause or
    // blocked loop cannot strand the latest layout in a discarded message.
    if (mailbox) writeFastLedMailbox(mailbox, frame, layout !== lastLayout ? positions : undefined)
    lastLayout = layout
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
  if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    throw new Error('FastLED needs an isolated browser page for WebAssembly threads. Reload the FastLED workspace from its own URL; the host must provide COOP and COEP headers.')
  }
  const imported = await import(/* @vite-ignore */ artifact.moduleUrl) as {
    default: (options: Record<string, unknown>) => Promise<FastLedModule>
  }
  if (typeof imported.default !== 'function') throw new Error('FastLED compiler artifact has no module factory.')
  if (!artifact.runtimeUrl) throw new Error('The FastLED compiler must provide its classic pthread runtime. Restart the updated compiler service and compile again.')
  // Browser workers cannot be constructed directly from the compiler's other
  // origin. A same-origin blob loads the unchanged classic Emscripten factory;
  // pthread workers must not load our ESM wrapper. Its URL lives with this
  // owning worker and remains valid for threads created after initialization.
  const pthreadBootstrap = URL.createObjectURL(new Blob([
    `importScripts(${JSON.stringify(artifact.runtimeUrl)});`,
  ], { type: 'application/javascript' }))
  module = await imported.default({
    noInitialRun: true,
    mainScriptUrlOrBlob: pthreadBootstrap,
    // Preserve each upstream filename, including side modules if the compiler
    // emits more than one WASM asset. Never redirect all modules to one binary.
    locateFile: (file: string) => new URL(file, artifact.moduleUrl).href,
    pxlblzOnFrame: sendFrame,
    print: () => undefined,
    printErr: (message: string) => scope.postMessage({ type: 'log', message }),
  })
  // User setup may intentionally animate for minutes. Only loading the module
  // has a deadline; its execution remains cancellable by terminating this worker.
  scope.postMessage({ type: 'module-loaded' })
  await module._extern_setup()
  sendFrame()
  scope.postMessage({ type: 'ready' })
  if (running) void tick()
}

scope.onmessage = (event: MessageEvent<{ type: string; artifact?: FastLedArtifact; mailbox?: SharedArrayBuffer }>) => {
  if (event.data.type === 'load' && event.data.artifact) {
    mailbox = event.data.mailbox
    void load(event.data.artifact).catch(fail)
  }
  else if (event.data.type === 'start' && !running) { running = true; lastLayout = ''; void tick() }
  else if (event.data.type === 'pause') { running = false; clearTimeout(timer) }
}
