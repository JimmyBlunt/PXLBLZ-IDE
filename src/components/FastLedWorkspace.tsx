import { useEffect, useRef, useState } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { createRenderer, type Renderer } from '@/engine/renderer'
import { MAX_PIXEL_COUNT } from '@/engine/camera'
import { compileFastLed, createFastLedRuntime, FASTLED_DEMOS } from '@/engine/fastled'
import { NumberField } from '@/components/ui/number-field'
import { setRouterNavigationPreflight } from '@/store/routerStore'
import { parseFastLedProject, serializeFastLedProject, validateFastLedFilename, validateFastLedFiles } from '@/engine/fastled/project'
import './FastLedWorkspace.css'

type Runtime = Awaited<ReturnType<typeof createFastLedRuntime>>
type Status = 'idle' | 'compiling' | 'running' | 'paused' | 'error'

/** A separate C++ workspace: its source never enters the Pixelblaze compiler. */
export function FastLedWorkspace({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState(FASTLED_DEMOS[0]?.source ?? '')
  const [files, setFiles] = useState<Record<string, string>>({ ...FASTLED_DEMOS[0]?.files })
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [filename, setFilename] = useState(`${FASTLED_DEMOS[0]?.id ?? 'sketch'}.ino`)
  const [demoId, setDemoId] = useState<string>(FASTLED_DEMOS[0]?.id ?? '')
  const [compilerUrl, setCompilerUrl] = useState('http://127.0.0.1:9982')
  const [status, setStatus] = useState<Status>('idle')
  const [diagnostics, setDiagnostics] = useState('')
  const [version, setVersion] = useState('')
  const [pixelCount, setPixelCount] = useState(0)
  const [columns, setColumns] = useState(30)
  const [layoutMode, setLayoutMode] = useState<'sketch' | 'grid'>('sketch')
  const [hasSketchLayout, setHasSketchLayout] = useState(false)
  const [applied, setApplied] = useState(false)
  const [unsaved, setUnsaved] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const projectFileRef = useRef<HTMLInputElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const runtimeRef = useRef<Runtime | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const revisionRef = useRef(0)
  const frameRef = useRef<Float32Array>(new Float32Array(0))
  const countRef = useRef(0)
  const columnsRef = useRef(columns)
  const layoutModeRef = useRef(layoutMode)
  const sketchLayoutRef = useRef<[number, number][] | null>(null)
  const editorSource = selectedFile === null ? source : files[selectedFile] ?? ''

  function layoutFrame() {
    const viewport = viewportRef.current
    const renderer = rendererRef.current
    if (!viewport || !renderer) return
    const count = countRef.current
    const width = Math.min(columnsRef.current, Math.max(1, count))
    const rows = Math.max(1, Math.ceil(count / width))
    const sketchPositions = layoutModeRef.current === 'sketch' && sketchLayoutRef.current?.length === count
      ? sketchLayoutRef.current : null
    const positions: [number, number][] = sketchPositions ?? Array.from({ length: count }, (_, index) => [
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
    sketchLayoutRef.current = null
    setHasSketchLayout(false)
    setDiagnostics('Compiling the sketch with the local FastLED service…')
    try {
      validateFastLedFiles(source, files)
      const artifact = await compileFastLed({ source, files, compilerUrl, signal: controller.signal })
      if (revision !== revisionRef.current) return
      setDiagnostics(artifact.diagnostics || 'Compilation succeeded.')
      setVersion(artifact.fastledVersion)
      const runtime = await createFastLedRuntime({
        artifact,
        signal: controller.signal,
        onLayout(positions) {
          if (revision !== revisionRef.current) return
          sketchLayoutRef.current = positions
          setHasSketchLayout(positions.length > 0)
          layoutFrame()
        },
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

  function downloadText(text: string, name: string) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function download() {
    downloadText(source, filename.endsWith('.ino') ? filename : `${filename}.ino`)
    if (Object.keys(files).length === 0) setUnsaved(false)
  }

  function downloadProject() {
    try {
      const name = filename.replace(/\.ino$/i, '')
      downloadText(serializeFastLedProject({ name, source, files }), `${name}.fastled.json`)
      setUnsaved(false)
    } catch (error) {
      setDiagnostics(error instanceof Error ? error.message : String(error))
      setStatus('error')
    }
  }

  async function importFile(file: File, isProject = false) {
    const mainFile = /\.ino$/i.test(file.name)
    if ((isProject || mainFile) && !canDiscard()) return
    if (!isProject && !mainFile && Object.prototype.hasOwnProperty.call(files, file.name)
      && !window.confirm(`Replace ${file.name} with the imported file?`)) return
    invalidate()
    const revision = revisionRef.current
    try {
      if (file.size > (isProject ? 8 : 1) * 1024 * 1024) throw new Error('The imported file is too large.')
      const text = await file.text()
      if (revision !== revisionRef.current) return
      setDemoId('')
      if (isProject) {
        const project = parseFastLedProject(text)
        replaceSource(project.source, /\.ino$/i.test(project.name) ? project.name : `${project.name}.ino`)
        setFiles(project.files)
        setSelectedFile(null)
        setUnsaved(false)
      } else if (mainFile) {
        validateFastLedFiles(text, {})
        replaceSource(text, file.name)
        setFiles({})
        setSelectedFile(null)
        setUnsaved(false)
      } else {
        validateFastLedFilename(file.name)
        const nextFiles = { ...files, [file.name]: text }
        validateFastLedFiles(source, nextFiles)
        setFiles(nextFiles)
        setSelectedFile(file.name)
        setUnsaved(true)
      }
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
            setFiles({ ...demo.files })
            setSelectedFile(null)
            setUnsaved(false)
          }}>
            <option value="" disabled>Custom sketch</option>
            {FASTLED_DEMOS.map((demo) => <option key={demo.id} value={demo.id}>{demo.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => fileRef.current?.click()}>Import source file</button>
        <button type="button" onClick={download}>Download .ino{Object.keys(files).length > 0 ? ' only' : ''}</button>
        <button type="button" onClick={() => projectFileRef.current?.click()}>Import project</button>
        <button type="button" onClick={downloadProject}>Download project</button>
        <input ref={fileRef} aria-label="Import source file" type="file" accept=".ino,.h,.hpp,.cpp,.c" hidden onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importFile(file)
          event.target.value = ''
        }} />
        <input ref={projectFileRef} aria-label="Import project file" type="file" accept=".json" hidden onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importFile(file, true)
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
          <div className="fastled-file-bar">
            <label>Project file<select aria-label="Project file" value={selectedFile ?? ''} onChange={(event) => setSelectedFile(event.target.value || null)}>
              <option value="">{filename}</option>
              {Object.keys(files).map((name) => <option key={name} value={name}>{name}</option>)}
            </select></label>
            <button type="button" disabled={selectedFile === null} onClick={() => {
              if (selectedFile === null) return
              const nextFiles = { ...files }
              delete nextFiles[selectedFile]
              invalidate()
              setFiles(nextFiles)
              setSelectedFile(null)
              setDemoId('')
              setUnsaved(true)
            }}>Remove file</button>
          </div>
          <div className="fastled-pane-heading"><span>{selectedFile ?? filename}{unsaved ? ' · Not downloaded' : ''}</span><span>C++ / Arduino</span></div>
          <MonacoEditor height="100%" language="cpp" theme="vs-dark" value={editorSource}
            onChange={(value) => {
              if (value === undefined || value === editorSource) return
              setDemoId('')
              if (selectedFile === null) replaceSource(value)
              else { invalidate(); setFiles({ ...files, [selectedFile]: value }) }
              setUnsaved(true)
            }}
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
            <label>Layout<select aria-label="Preview layout" value={layoutMode} onChange={(event) => {
              const mode = event.target.value === 'grid' ? 'grid' : 'sketch'
              layoutModeRef.current = mode
              setLayoutMode(mode)
              layoutFrame()
            }}><option value="sketch">Sketch layout</option><option value="grid">Index grid</option></select></label>
            <NumberField label="Columns" ariaLabel="Preview columns" min={1} max={512} value={columns} onChange={(nextValue) => {
              const value = Math.floor(nextValue)
              layoutModeRef.current = 'grid'
              setLayoutMode('grid')
              columnsRef.current = value
              setColumns(value)
              layoutFrame()
            }} />
          </div>
          <div ref={viewportRef} className="fastled-canvas-container"><canvas ref={canvasRef} aria-label="FastLED RGB frame" /></div>
          <div className="fastled-frame-note">{applied
            ? layoutMode === 'sketch' && hasSketchLayout ? 'Sketch output · Original LED layout' : 'Sketch output · LEDs arranged by index'
            : 'Compile the current source to update this preview'}</div>
          <div className="fastled-diagnostics" role="status" aria-live="polite">
            <strong>{status === 'idle' ? 'Ready to compile' : status === 'error' ? 'Error' : status === 'paused' ? 'Paused' : status === 'running' ? 'Running' : 'Compiling'}</strong>
            <pre>{diagnostics || 'Choose an example or import a sketch. Download your source to keep this session.'}</pre>
          </div>
        </div>
      </div>
      <footer>Source is held in this session. Download project saves the sketch and all support files; Download .ino saves the main file only. Importing a new .ino starts a new project. FastLED sketches run on this computer.</footer>
    </section>
  )
}
