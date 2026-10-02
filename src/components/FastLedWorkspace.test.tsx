import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FastLedWorkspace } from './FastLedWorkspace'
import { __resetRouterNavigationPreflightForTests, setRouterNavigationPreflight, useRouterStore } from '@/store/routerStore'
import { routePath } from '@/engine/routes'

const mocks = vi.hoisted(() => ({
  compile: vi.fn(),
  createRuntime: vi.fn(),
  paint: vi.fn(),
  positions: vi.fn(),
}))

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange, options }: { value: string; onChange: (value: string) => void; options?: { readOnly?: boolean } }) => (
    <textarea aria-label="C++ source" data-readonly={String(Boolean(options?.readOnly))}
      value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))
vi.mock('@/engine/renderer', () => ({
  createRenderer: () => ({ paint: mocks.paint, set2DPositions: mocks.positions }),
}))
vi.mock('@/engine/fastled', () => ({
  compileFastLed: mocks.compile,
  createFastLedRuntime: mocks.createRuntime,
  FASTLED_DEMOS: [
    { id: 'Blink', name: 'Blink', folder: 'Standard examples', source: '#include <FastLED.h>\nvoid loop() {}' },
    { id: 'Noise', name: 'Noise', folder: 'Standard examples', source: '#include "Noise.h"', files: { 'Noise.h': 'void setup() {} void loop() {}' } },
    { id: 'Animartrix', name: 'Animartrix', folder: 'Matrix & geometry', source: '#include <FastLED.h>\nvoid loop() { FastLED.show(); }' },
  ],
}))

function makeRuntime() {
  return { start: vi.fn(), pause: vi.fn(), reset: vi.fn(), dispose: vi.fn() }
}

const artifact = { id: 'compiled', moduleUrl: 'http://127.0.0.1:9982/module.js', fastledVersion: '3.10.4' }

beforeEach(() => {
  vi.clearAllMocks()
  __resetRouterNavigationPreflightForTests()
  useRouterStore.getState().navigate({ kind: 'fastled' })
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  mocks.compile.mockResolvedValue(artifact)
  mocks.createRuntime.mockResolvedValue(makeRuntime())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('FastLED workspace', () => {
  it('groups official examples and requires an explicit editable copy', () => {
    render(<FastLedWorkspace onClose={vi.fn()} />)
    const selector = screen.getByRole('combobox', { name: 'Official example' })
    expect(screen.getByRole('group', { name: 'Standard examples' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Matrix & geometry' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'C++ source' })).toHaveAttribute('data-readonly', 'true')

    fireEvent.change(selector, { target: { value: 'Animartrix' } })
    expect(screen.getByRole('textbox', { name: 'C++ source' })).toHaveValue('#include <FastLED.h>\nvoid loop() { FastLED.show(); }')
    expect(screen.getByRole('textbox', { name: 'C++ source' })).toHaveAttribute('data-readonly', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Copy to editable sketch' }))
    expect(screen.getByRole('textbox', { name: 'C++ source' })).toHaveAttribute('data-readonly', 'false')
    expect(screen.getByText('Copied official example into an editable sketch.')).toBeInTheDocument()
  })

  it('cancels initialization and disposes a late runtime without replacing the source', async () => {
    const runtime = makeRuntime()
    let finish!: (value: ReturnType<typeof makeRuntime>) => void
    mocks.createRuntime.mockReturnValue(new Promise(resolve => { finish = resolve }))
    render(<FastLedWorkspace onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Compile & run' }))
    await waitFor(() => expect(mocks.createRuntime).toHaveBeenCalledOnce())
    const signal = mocks.createRuntime.mock.calls[0][0].signal as AbortSignal
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(signal.aborted).toBe(true)
    expect(screen.getByText('Cancelled.')).toBeInTheDocument()
    await act(async () => finish(runtime))
    expect(runtime.dispose).toHaveBeenCalledOnce()
    expect(runtime.start).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'C++ source' })).toHaveValue('#include <FastLED.h>\nvoid loop() {}')
  })
  it('renders the runtime RGB bytes through the existing renderer and controls playback', async () => {
    const runtime = makeRuntime()
    mocks.createRuntime.mockResolvedValue(runtime)
    render(<FastLedWorkspace onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Compile & run' }))
    await waitFor(() => expect(runtime.start).toHaveBeenCalledOnce())
    const { onFrame } = mocks.createRuntime.mock.calls[0][0]
    act(() => onFrame(new Uint8Array([255, 0, 128, 0, 255, 0])))
    expect(screen.getByText('2 LEDs')).toBeInTheDocument()
    const lastPaint = mocks.paint.mock.calls[mocks.paint.mock.calls.length - 1]
    const frame = lastPaint[0] as Float32Array
    expect(Array.from(frame)).toEqual([1, 0, Math.fround(128 / 255), 0, 1, 0])
    expect(lastPaint.slice(1)).toEqual([1, false])
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(runtime.pause).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(runtime.start).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(runtime.reset).toHaveBeenCalledOnce()
  })

  it('discards a stale compilation when the source changes', async () => {
    let finish!: (value: typeof artifact) => void
    mocks.compile.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    render(<FastLedWorkspace onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Compile & run' }))
    const signal = mocks.compile.mock.calls[0][0].signal as AbortSignal
    fireEvent.change(screen.getByRole('textbox', { name: 'C++ source' }), { target: { value: 'changed source' } })
    expect(signal.aborted).toBe(true)
    await act(async () => finish(artifact))
    expect(mocks.createRuntime).not.toHaveBeenCalled()
    expect(screen.getByText('Ready to compile')).toBeInTheDocument()
  })

  it('uses the upstream layout by default and switches to an index grid without changing RGB output', async () => {
    const runtime = makeRuntime()
    mocks.createRuntime.mockResolvedValue(runtime)
    render(<FastLedWorkspace onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Compile & run' }))
    await waitFor(() => expect(runtime.start).toHaveBeenCalledOnce())
    const { onLayout, onFrame } = mocks.createRuntime.mock.calls[0][0]
    act(() => {
      onLayout([[0.1, 0.2], [0.3, 0.4]])
      onFrame(new Uint8Array([255, 0, 0, 0, 255, 0]))
    })
    expect(mocks.positions.mock.calls[mocks.positions.mock.calls.length - 1][0]).toEqual([[0.1, 0.2], [0.3, 0.4]])
    fireEvent.change(screen.getByRole('combobox', { name: 'Preview layout' }), { target: { value: 'grid' } })
    expect(mocks.positions.mock.calls[mocks.positions.mock.calls.length - 1][0]).toEqual([[0, 0.5], [1, 0.5]])
    expect(Array.from(mocks.paint.mock.calls[mocks.paint.mock.calls.length - 1][0] as Float32Array)).toEqual([1, 0, 0, 0, 1, 0])
    expect(runtime.start).toHaveBeenCalledOnce()
  })

  it('disposes a runtime that finishes loading after the workspace closes', async () => {
    const runtime = makeRuntime()
    let finish!: (value: ReturnType<typeof makeRuntime>) => void
    mocks.createRuntime.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const { unmount } = render(<FastLedWorkspace onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Compile & run' }))
    await waitFor(() => expect(mocks.createRuntime).toHaveBeenCalledOnce())
    unmount()
    await act(async () => finish(runtime))
    expect(runtime.dispose).toHaveBeenCalledOnce()
    expect(runtime.start).not.toHaveBeenCalled()
  })

  it('surfaces compiler failures without running a sketch', async () => {
    mocks.compile.mockRejectedValue(new Error('sketch.ino:4: unknown identifier'))
    render(<FastLedWorkspace onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Compile & run' }))
    expect(await screen.findByText('sketch.ino:4: unknown identifier')).toBeInTheDocument()
    expect(mocks.createRuntime).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
  })

  it('protects edits when closing or leaving the browser page', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<FastLedWorkspace onClose={() => useRouterStore.getState().navigate({ kind: 'gallery' })} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'C++ source' }), { target: { value: 'changed source' } })
    fireEvent.click(screen.getByRole('button', { name: 'Back to PXLBLZ' }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(useRouterStore.getState().route.kind).toBe('fastled')
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Back to PXLBLZ' }))
    expect(useRouterStore.getState().route.kind).toBe('gallery')
  })

  it('rejects browser history navigation and restores the sketch URL', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<FastLedWorkspace onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'C++ source' }), { target: { value: 'keep this sketch' } })
    window.history.replaceState(null, '', routePath({ kind: 'gallery' }, import.meta.env.BASE_URL))
    act(() => useRouterStore.getState().syncFromLocation())
    expect(useRouterStore.getState().route.kind).toBe('fastled')
    expect(window.location.pathname).toBe(routePath({ kind: 'fastled' }, import.meta.env.BASE_URL))
    expect(screen.getByRole('textbox', { name: 'C++ source' })).toHaveValue('keep this sketch')
  })

  it('restores the previous navigation guard on unmount', () => {
    const previousGuard = vi.fn((transition: () => void) => { transition(); return true })
    setRouterNavigationPreflight(previousGuard)
    const { unmount } = render(<FastLedWorkspace onClose={vi.fn()} />)
    unmount()
    useRouterStore.getState().navigate({ kind: 'gallery' })
    expect(previousGuard).toHaveBeenCalledOnce()
  })

  it('edits a demo support file and submits it with the unchanged main source', async () => {
    render(<FastLedWorkspace onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Official example' }), { target: { value: 'Noise' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Project file' }), { target: { value: 'Noise.h' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'C++ source' }), { target: { value: 'void setup() {} void loop() { FastLED.show(); }' } })
    fireEvent.click(screen.getByRole('button', { name: 'Compile & run' }))
    await waitFor(() => expect(mocks.compile).toHaveBeenCalledOnce())
    expect(mocks.compile.mock.calls[0][0]).toMatchObject({
      source: '#include "Noise.h"', files: { 'Noise.h': 'void setup() {} void loop() { FastLED.show(); }' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove file' }))
    expect(screen.queryByRole('option', { name: 'Noise.h' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'C++ source' })).toHaveValue('#include "Noise.h"')
  })

  it('imports a project with support files and a new ino clears those files', async () => {
    render(<FastLedWorkspace onClose={vi.fn()} />)
    const projectFile = new File([''], 'example.fastled.json')
    Object.defineProperty(projectFile, 'text', { value: async () => JSON.stringify({
      format: 'pxlblz-fastled', version: 1, name: 'Imported', source: '#include "helper.h"', files: { 'helper.h': '// header' },
    }) })
    fireEvent.change(screen.getByLabelText('Import project file'), { target: { files: [projectFile] } })
    await screen.findByRole('option', { name: 'helper.h' })
    const mainFile = new File([''], 'Replacement.ino')
    Object.defineProperty(mainFile, 'text', { value: async () => '// replacement sketch' })
    fireEvent.change(screen.getByLabelText('Import source file', { selector: 'input' }), { target: { files: [mainFile] } })
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'C++ source' })).toHaveValue('// replacement sketch'))
    expect(screen.queryByRole('option', { name: 'helper.h' })).not.toBeInTheDocument()
  })
})
