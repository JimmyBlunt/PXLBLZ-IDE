import { useEffect, useRef, useState } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { createRenderer, type Renderer } from '@/engine/renderer'
import { MAX_PIXEL_COUNT } from '@/engine/camera'
import { compileFastLed, createFastLedRuntime, FASTLED_DEMOS } from '@/engine/fastled'
import { NumberField } from '@/components/ui/number-field'
import { setRouterNavigationPreflight } from '@/store/routerStore'
import './FastLedWorkspace.css'

type Runtime = Awaited<ReturnType<typeof createFastLedRuntime>>
type Status = 'idle' | 'compiling' | 'running' | 'paused' | 'error'

/** A separate C++ workspace: its source never enters the Pixelblaze compiler. */
export function FastLedWorkspace({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState(FASTLED_DEMOS[0]?.source ?? '')
  const [filename, setFilename] = useState(`${FASTLED_DEMOS[0]?.id ?? 'sketch'}.ino`)
  const [demoId, setDemoId] = useState<string>(FASTLED_DEMOS[0]?.id ?? '')
  const [compilerUrl, setCompilerUrl] = useState('http://127.0.0.1:9982')
  const [status, setStatus] = useState<Status>('idle')
  const [diagnostics, setDiagnostics] = useState('')
  const [version, setVersion] = useState('')
  const [pixelCount, setPixelCount] = useState(0)
  const [columns, setColumns] = useState(30)
  const [applied, setApplied] = useState(false)
  const [unsaved, setUnsaved] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const runtimeRef = useRef<Runtime | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const revisionRef = useRef(0)
  const frameRef = useRef<Float32Array>(new Float32Array(0))
  const countRef = useRef(0)
  const columnsRef = useRef(columns)

  function layoutFrame() {
    const viewport = viewportRef.current
    const renderer = rendererRef.current
    if (!viewport || !renderer) return
    const count = countRef.current
    const width = Math.min(columnsRef.current, Math.max(1, count))
    const rows = Math.max(1, Math.ceil(count / width))
    const positions: [number, number][] = Array.from({ length: count }, (_, index) => [
      width === 1 ? 0.5 : (index % width) / (width - 1),
      rows === 1 ? 0.5 : Math.floor(index / width) / (rows - 1),
    ])
    renderer.set2DPositions(positions, {
      containerWidth: Math.max(1, viewport.clientWidth),
      containerHeight: Math.max(1, viewport.clientHeight),
      lightSize: 0.8,
    })
    renderer.paint(frameRef.current, 1, false)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const viewport = viewportRef.current
    if (!canvas || !viewport) return
    rendererRef.current = createRenderer(canvas, { containerWidth: viewport.clientWidth || 480 })
    const observer = new ResizeObserver(() => layoutFrame())
    const revision = revisionRef
    observer.observe(viewport)
    return () => {
      observer.disconnect()
      revision.current++
      abortRef.current?.abort()
      runtimeRef.current?.dispose()
      runtimeRef.current = null
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!unsaved) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [unsaved])

  useEffect(() => setRouterNavigationPreflight((transition) => {
    if (unsaved && !window.confirm('This sketch has changes that have not been downloaded. Discard these changes?')) return false
    transition()
    return true
  }), [unsaved])

  function canDiscard() {
    return !unsaved || window.confirm('This sketch has changes that have not been downloaded. Discard these changes?')
  }

  function invalidate() {
    revisionRef.current++
    abortRef.current?.abort()
    abortRef.current = null
    runtimeRef.current?.dispose()
    runtimeRef.current = null
    setApplied(false)
    setStatus('idle')
    setDiagnostics('Source changed. Compile to update the preview.')
  }

  function replaceSource(nextSource: string, nextFilename?: string) {
    invalidate()
    setSource(nextSource)
    if (nextFilename) setFilename(nextFilename)
  }

  async function compile() {
    const revision = ++revisionRef.current
    abortRef.current?.abort()
    runtimeRef.current?.dispose()
    runtimeRef.current = null
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('compiling')
    setApplied(false)
    setDiagnostics('Compiling the sketch with the local FastLED service…')
    try {
      const artifact = await compileFastLed({ source, compilerUrl, signal: controller.signal })
      if (revision !== revisionRef.current) return
      setDiagnostics(artifact.diagnostics || 'Compilation succeeded.')
      setVersion(artifact.fastledVersion)
      const runtime = await createFastLedRuntime({
        artifact,
        signal: controller.signal,
        onFrame(frame) {
          if (revision !== revisionRef.current) return
          if (frame.length % 3 !== 0 || frame.length / 3 > MAX_PIXEL_COUNT) {
            runtimeRef.current?.pause()
            setStatus('error')
            setDiagnostics(`Invalid RGB frame, or more than ${MAX_PIXEL_COUNT.toLocaleString()} LEDs.`)
            return
          }
          if (frameRef.current.length !== frame.length) frameRef.current = new Float32Array(frame.length)
          for (let index = 0; index < frame.length; index++) frameRef.current[index] = frame[index] / 255
          if (countRef.current !== frame.length / 3) {
            countRef.current = frame.length / 3
            setPixelCount(countRef.current)
            layoutFrame()
          } else {
            rendererRef.current?.paint(frameRef.current, 1, false)
          }
        },
        onError(message) {
          if (revision !== revisionRef.current) return
          setStatus('error')
          setDiagnostics(message)
        },
      })
      if (revision !== revisionRef.current) {
        runtime.dispose()
        return
      }
      runtimeRef.current = runtime
      setApplied(true)
      setStatus('running')
      runtime.start()
    } catch (error) {
      if (revision !== revisionRef.current || controller.signal.aborted) return
      setStatus('error')
      setDiagnostics(error instanceof Error ? error.message : String(error))
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename.endsWith('.ino') ? filename : `${filename}.ino`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setUnsaved(false)
  }

  async function importFile(file: File) {
    if (!canDiscard()) return
    invalidate()
    const revision = revisionRef.current
    try {
      const text = await file.text()
      if (revision !== revisionRef.current) return
      setDemoId('')
      replaceSource(text, file.name)
      setUnsaved(false)
    } catch (error) {
      if (revision !== revisionRef.current) return
      setStatus('error')
      setDiagnostics(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <section className="fastled-workspace" aria-label="FastLED workspace">
      <header className="fastled-header">
        <div><h1>FastLED</h1><p>C++ sketches · Computer preview{version ? ` · FastLED ${version}` : ''}</p></div>
        <button type="button" onClick={onClose}>Back to PXLBLZ</button>
      </header>
      <div className="fastled-toolbar">
        <label>Official example
          <select value={demoId} onChange={(event) => {
            const demo = FASTLED_DEMOS.find((item) => item.id === event.target.value)
            if (!demo || !canDiscard()) return
            setDemoId(demo.id)
            replaceSource(demo.source, `${demo.id}.ino`)
            setUnsaved(false)
          }}>
            <option value="" disabled>Custom sketch</option>
            {FASTLED_DEMOS.map((demo) => <option key={demo.id} value={demo.id}>{demo.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => fileRef.current?.click()}>Import .ino</button>
        <button type="button" onClick={download}>Download .ino</button>
        <input ref={fileRef} type="file" accept=".ino" hidden onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importFile(file)
          event.target.value = ''
        }} />
        <label className="fastled-endpoint">Compiler service
          <input aria-label="Compiler service URL" value={compilerUrl} spellCheck={false} onChange={(event) => {
            invalidate()
            setCompilerUrl(event.target.value)
          }} />
        </label>
      </div>
      <div className="fastled-panes">
        <div className="fastled-code">
          <div className="fastled-pane-heading"><span>{filename}{unsaved ? ' · Not downloaded' : ''}</span><span>C++ / Arduino</span></div>
          <MonacoEditor height="100%" language="cpp" theme="vs-dark" value={source}
            onChange={(value) => { if (value !== undefined && value !== source) { setDemoId(''); replaceSource(value); setUnsaved(true) } }}
            options={{ automaticLayout: true, minimap: { enabled: false }, fontSize: 13, tabSize: 2, scrollBeyondLastLine: false }} />
        </div>
        <div className="fastled-preview">
          <div className="fastled-pane-heading"><span>LED preview</span><span>{pixelCount.toLocaleString()} LEDs</span></div>
          <div className="fastled-transport">
            <button type="button" className="fastled-primary" disabled={status === 'compiling' || !source.trim()} onClick={() => void compile()}>
              {status === 'compiling' ? 'Compiling…' : 'Compile & run'}
            </button>
            <button type="button" disabled={!applied || status === 'error'} onClick={() => {
              if (status === 'running') { runtimeRef.current?.pause(); setStatus('paused') }
              else { runtimeRef.current?.start(); setStatus('running') }
            }}>{status === 'running' ? 'Pause' : 'Run'}</button>
            <button type="button" disabled={!applied} onClick={() => {
              runtimeRef.current?.reset()
              runtimeRef.current?.start()
              setStatus('running')
            }}>Reset</button>
            <NumberField label="Columns" ariaLabel="Preview columns" min={1} max={512} value={columns} onChange={(nextValue) => {
              const value = Math.floor(nextValue)
              columnsRef.current = value
              setColumns(value)
              layoutFrame()
            }} />
          </div>
          <div ref={viewportRef} className="fastled-canvas-container"><canvas ref={canvasRef} aria-label="FastLED RGB frame" /></div>
          <div className="fastled-frame-note">{applied ? 'Sketch output · LEDs arranged by index' : 'Compile the current source to update this preview'}</div>
          <div className="fastled-diagnostics" role="status" aria-live="polite">
            <strong>{status === 'idle' ? 'Ready to compile' : status === 'error' ? 'Error' : status === 'paused' ? 'Paused' : status === 'running' ? 'Running' : 'Compiling'}</strong>
            <pre>{diagnostics || 'Choose an example or import a sketch. Download your source to keep this session.'}</pre>
          </div>
        </div>
      </div>
      <footer>Source is held in this session. Use Download .ino to save your work. FastLED sketches run on this computer.</footer>
    </section>
  )
}
