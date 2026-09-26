// The #1029 sequence against a `ShowRecordV2`, through the real browser MCP
// path (#1039, specification section 12 row MCP).
//
// Nothing here is simulated between the tool call and the saved record: a real
// Worker runs in Miniflare with the real OAuth authority and account Durable
// Object, a real `createAgentBrowserSession` holds the binding and runs its own
// receive loop, and it drives the real editor admission, private executor and
// v2 candidate admission over the real Show store. The oracles are what a
// consumer sees - the provider's saved record and the reopened `.pxlshow` and
// `.epe` - plus the store's history and save counts.
//
// The one thing this does not run is a browser engine: esbuild cannot bundle
// the Worker inside jsdom, so the test supplies the minimal window surface the
// admission observes - the route path and the history/navigation events it
// closes on. Its Chromium proof drove the rejected v2 route and was retired
// with that route (#1065); the existing editor's own agent proof is #1066.
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { createSessionToken } from '../../cloudflare/auth'
import { createAgentBrowserSession } from '../../agent/browserSession'
import { createAgentEditorAdmission } from '../../agent/editorAdmission'
import { convertShowRecordV1ToV2 } from '../../engine/showRecordV1ToV2'
import { convertibleV1Show } from '../../test/showV2TracerFixture'
import { captureShowStageEditV2, prepareShowStageV2 } from '../../engine/showPreparedStageV2'
import { buildShowEpeExportV2 } from '../../engine/showEpeExportV2'
import { buildShowFileBundle, parseShowFileBundle, serializeShowFileBundle } from '../../engine/showFileBundle'
import { getPersonalContentProvider, resetPersonalContentProvider, setPersonalContentProvider } from '../../engine/personalContentProvider'
import { showInitialState, useShowStore } from '../../store/showStore'
import { usePatternStore } from '../../store/patternStore'
import { admitShowV2PilotSetShowEnd } from '../../store/showV2PreparedEditAdmission'
import { STOCK_SHOW_IDS } from '../../pixelblaze/stock/showIds'
import { SHOW_COMMANDS_V2 } from '../../engine/showCommandsV2/registry'
import type { ShowRecordV2 } from '../../engine/showCompositionV2'
import { validateShowRecordV2 } from '../../engine/showCompositionV2'
import { nativeShowV2Artifacts, exportedScalar } from '../../test/showV2IntegratedSequenceHarness'
import { showMcpReplacementCases, showMcpGainPattern, showMcpGainReplacement } from '../../test/showMcpReplacementFixtures'
import { showV2LayoutEditorFixture } from '../../test/showV2LayoutEditorFixture'
import { encodeFastReplaySnapshot } from '../../engine/fastReplay'

globalThis.Blob = (await import('node:buffer')).Blob as unknown as typeof globalThis.Blob

// The admission observes actual route changes to close itself; nothing else in
// this path touches the DOM.
const routeListeners = new Map<string, Set<() => void>>()
let routePath = '/'
// This project shares one process across test files (`isolate: false`), and
// Zustand's persist middleware captures `window.localStorage` once, when a
// persisted store module is first imported. A window without storage would
// leave every such store imported from here on crashing on its first write, in
// whichever later file touched it, so the shim carries working storage and is
// removed when this file ends (#1039).
function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) },
  }
}
const hadWindow = 'window' in globalThis
globalThis.window = {
  localStorage: memoryStorage(),
  sessionStorage: memoryStorage(),
  location: { get pathname() { return routePath } },
  history: {
    pushState: (_state: unknown, _title: string, url: string) => { routePath = new URL(url, 'https://app.test').pathname },
    replaceState: (_state: unknown, _title: string, url: string) => { routePath = new URL(url, 'https://app.test').pathname },
  },
  addEventListener: (type: string, listener: () => void) => {
    if (!routeListeners.has(type)) routeListeners.set(type, new Set())
    routeListeners.get(type)!.add(listener)
  },
  removeEventListener: (type: string, listener: () => void) => { routeListeners.get(type)?.delete(listener) },
} as unknown as Window & typeof globalThis

const VOICE = 'export var t = 0\nexport function beforeRender(delta) { t += delta }\nexport function render2D(index, x, y) { rgb(x, y, t / 1000) }'
const PATTERN = { id: 'voice', name: 'Voice', src: VOICE, controls: {}, updatedAt: 1 }
const client = { clientId: 'test-client', clientName: 'Test Agent', redirectUris: ['https://client.test/callback'] }
const verifier = 'b'.repeat(43)

let script: string
let runtime: Miniflare
let cookie: string
const runtimes: Miniflare[] = []
beforeAll(async () => {
  const bundle = await build({ entryPoints: ['src/worker/index.ts'], external: ['cloudflare:workers'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' })
  script = bundle.outputFiles[0].text
  cookie = `pxlblz_session=${await createSessionToken({ userId: 'github:123', primaryProvider: 'github', primaryHandle: null, displayName: null, avatarUrl: null }, 'v2-command-secret')}`
}, 60_000)
afterAll(async () => {
  await Promise.all(runtimes.map(entry => entry.dispose()))
  resetPersonalContentProvider()
  if (!hadWindow) delete (globalThis as { window?: unknown }).window
})

function startRuntime() {
  const started = new Miniflare(convertV4MiniflareOptions({
    modules: true, script, compatibilityDate: '2026-06-30',
    compatibilityFlags: ['global_fetch_strictly_public'],
    bindings: {
      SESSION_SECRET: 'v2-command-secret', AGENT_SERVICE_ENABLED: '1', AGENT_ACCOUNT_ALLOWLIST: 'github:123',
      AGENT_OAUTH_ORIGIN: 'https://app.test', AGENT_OAUTH_CLIENTS: JSON.stringify([client]),
    },
    durableObjects: {
      AGENT_ACCOUNTS: { className: 'AgentAccount', useSQLite: true },
      AGENT_OAUTH_AUTHORITY: { className: 'AgentOAuthAuthority', useSQLite: true },
    },
  }))
  runtimes.push(started)
  return started
}

/** One real authorization-code grant for the canonical MCP endpoint. */
async function authorize(): Promise<string> {
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url')
  const authorizeUrl = `https://app.test/oauth/authorize?${new URLSearchParams({
    agent: '1', client_id: client.clientId, redirect_uri: client.redirectUris[0], response_type: 'code',
    scope: 'agent:connect', state: 'v2-state', resource: 'https://app.test/mcp',
    code_challenge_method: 'S256', code_challenge: challenge,
  })}`
  const consent = await (await runtime.dispatchFetch(authorizeUrl, { headers: { Cookie: cookie } })).text()
  const nonce = consent.match(/name="nonce" value="([^"]+)"/)![1]
  const answered = await runtime.dispatchFetch('https://app.test/oauth/authorize', {
    method: 'POST', headers: { Origin: 'https://app.test', Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ nonce, decision: 'allow' }).toString(), redirect: 'manual',
  })
  const code = new URL(answered.headers.get('Location')!).searchParams.get('code')!
  const token = await runtime.dispatchFetch('https://app.test/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.clientId, resource: 'https://app.test/mcp', grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: client.redirectUris[0] }).toString(),
  })
  return (await token.json() as { access_token: string }).access_token
}

function v2Record(id: string): ShowRecordV2 {
  const converted = convertShowRecordV1ToV2(convertibleV1Show())
  if (converted.status !== 'converted') throw new Error('Conversion')
  const record = converted.record
  record.id = id
  record.name = 'Commanded v2 Show'
  record.composition.showEndMs = 20_000
  record.composition.layoutOccurrences[0].durationMs = 20_000
  record.composition.clips[0].durationMs = 10_000
  for (const instance of record.composition.patternInstances) instance.pattern = { kind: 'user', id: 'voice' }
  return record
}

it('runs the #1029 sequence over a v2 record through the real MCP path and reopens the saved artifacts', async () => {
  runtime = startRuntime()
  const token = await authorize()
  // The channel route resolves same-account Show authority before it registers
  // a window; a built-in identity gives that without a D1 binding. The record
  // this editor holds is the v2 one below, exactly as a converted row would be.
  const record = v2Record(STOCK_SHOW_IDS[0])
  window.history.replaceState(null, '', `/studio/shows/${record.id}`)
  useShowStore.setState(showInitialState)
  let saved = structuredClone(record)
  const write = vi.fn(async (_id: string, next: ShowRecordV2) => { saved = structuredClone(next) })
  setPersonalContentProvider({
    ...getPersonalContentProvider(), id: 'mcp-v2', replaceShowV2: write,
    listShowDocumentsV2: async () => [structuredClone(saved)],
  })
  usePatternStore.setState({ userPatterns: [PATTERN], patternsLoaded: true } as never)
  useShowStore.setState({ showV2Pilots: { [record.id]: record }, showV2Histories: { [record.id]: { past: [], future: [] } } })

  const dependencies = { patterns: [PATTERN], maps: [], libraries: [], profiles: [], stageMap: null }
  let capture = captureShowStageEditV2(record, dependencies)
  expect(capture.prepared.status).toBe('ready')
  const unsubscribe = useShowStore.subscribe(() => {
    const current = useShowStore.getState().showV2Pilots[record.id]
    if (current && current !== capture.record) capture = captureShowStageEditV2(current, dependencies)
  })
  const admission = createAgentEditorAdmission(record.id, () => ({ playheadMs: 0 }), undefined, undefined, {
    capture: () => capture,
    isCurrentCapture: () => useShowStore.getState().showV2Pilots[record.id] === capture.record,
  })
  const session = createAgentBrowserSession({
    admission, showId: record.id,
    fetch: (async (_url: string, init: RequestInit) => {
      const response = await runtime.dispatchFetch('https://app.test/api/agent/channel?agent=1', {
        method: 'POST', headers: { Origin: 'https://app.test', 'Content-Type': 'application/json', Cookie: cookie },
        body: init.body as string,
      })
      return Response.json(await response.json())
    }) as unknown as typeof fetch,
  })

  const rpc = async (method: string, params?: unknown) => {
    const response = await runtime.dispatchFetch('https://app.test/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
    })
    return await response.json() as { result: { structuredContent: Record<string, unknown>; tools?: Array<{ name: string }>; isError?: boolean } }
  }
  const tool = (name: string, args: object = {}) => rpc('tools/call', { name, arguments: args })

  try {
    await session.ready
    await session.arm()
    const connected = await tool('get_connection')
    expect(connected.result.structuredContent.code).toBe('bound')
    const binding_id = connected.result.structuredContent.binding_id as string

    // The registered tool surface is the one this v2 record's commands need.
    const listed = new Set((await rpc('tools/list')).result.tools!.map(entry => entry.name))
    for (const command of SHOW_COMMANDS_V2) expect(listed, command.name).toContain(command.name)
    expect(listed).not.toContain('add_clip')

    const read = await tool('read_show', { binding_id })
    expect(read.result.structuredContent.code).toBe('read')
    expect((read.result.structuredContent.show as ShowRecordV2).version).toBe(2)
    expect(read.result.structuredContent.show).toEqual(record)

    const begun = await tool('begin_edit', { binding_id, intent: 'Rebuild the overlay', idempotency_key: 'begin' })
    expect(begun.result.structuredContent.code).toBe('begun')
    const operation_id = begun.result.structuredContent.operation_id as string
    const identity = { binding_id, operation_id }

    const created = await tool('create_layers', {
      ...identity, idempotency_key: 'layers',
      layers: [{
        zone_id: record.zones[0].id, name: 'Overlay',
        clips: [{ zone_id: record.zones[0].id, start_ms: 0, duration_ms: 8_000, pattern: { kind: 'user', id: 'voice' }, instance: 'sole' }],
      }],
    })
    expect(created.result.structuredContent.code).toBe('changed')
    const changes = created.result.structuredContent.changes as Array<{ details: { layers: string[]; clips: string[] } }>
    const newLayerId = changes.flatMap(change => change.details.layers)[0]
    const newClipId = changes.flatMap(change => change.details.clips)[0]

    expect((await tool('remove_clips', { ...identity, idempotency_key: 'remove', clip_ids: [record.composition.clips[0].id] })).result.structuredContent.code).toBe('changed')
    expect((await tool('set_show_end', { ...identity, idempotency_key: 'end', end_ms: 30_000 })).result.structuredContent.code).toBe('changed')
    expect((await tool('add_property_tracks', {
      ...identity, idempotency_key: 'tracks',
      tracks: [{ target: { kind: 'opacity', clip_id: newClipId }, keyframes: [{ at_ms: 0, value: 0, easing: 'linear' }, { at_ms: 8_000, value: 1, easing: 'linear' }] }],
    })).result.structuredContent.code).toBe('changed')

    // A domain refusal reaches the caller and leaves the private candidate open.
    const refused = await tool('remove_clips', { ...identity, idempotency_key: 'bad', clip_ids: ['not-a-clip'] })
    expect(refused.result.structuredContent.code).toBe('refused')
    expect(write).not.toHaveBeenCalled()

    expect((await tool('commit_edit', { ...identity, idempotency_key: 'commit' })).result.structuredContent.code).toBe('outcome')
    await vi.waitFor(async () => {
      const outcome = await tool('get_outcome', identity)
      expect(outcome.result.structuredContent).toMatchObject({ code: 'outcome', receipt: { status: 'applied', settlement: 'saved' } })
    })

    expect(write).toHaveBeenCalledTimes(1)
    expect(useShowStore.getState().showV2Histories[record.id].past).toHaveLength(1)
    expect(saved.composition.showEndMs).toBe(30_000)
    expect(saved.composition.clips.map(clip => clip.id)).toEqual([newClipId])
    expect(saved.composition.layers.some(entry => entry.id === newLayerId)).toBe(true)
    expect(saved.composition.propertyTracks).toHaveLength(1)

    const bundle = buildShowFileBundle(saved, { patterns: [PATTERN], maps: [], libraries: [] }, { appVersion: 'mcp-v2', exportedAt: '2026-01-01T00:00:00.000Z' })
    const reopened = await parseShowFileBundle(await serializeShowFileBundle(bundle.bundle), { acceptV2: true })
    expect(reopened.version).toBe(2)
    expect(reopened.show).toEqual(saved)
    const prepared = prepareShowStageV2(saved, dependencies)
    expect(prepared.status).toBe('ready')
    if (prepared.status !== 'ready') throw new Error('prepared')
    expect(buildShowEpeExportV2(saved, prepared.bundle.artifact.code).status).toBe('exported')
  } finally {
    session.close()
    unsubscribe()
    admission.close()
  }
}, 120_000)

/** One live binding over a v2 record, with the store and provider behind it. */
let identityIndex = 0
async function boundEditor(options: { failSave?: boolean; patterns?: ReadonlyArray<typeof PATTERN>; beforeSave?: (id: string, record: ShowRecordV2) => Promise<void> } = {}) {
  runtime = startRuntime()
  const token = await authorize()
  const patterns = [PATTERN, ...(options.patterns ?? [])]
  // A distinct Show identity per test: the store's durable v2 baseline is
  // module state keyed by Show id, so a reused id would let one test's saved
  // record become the next test's rollback target.
  const record = v2Record(STOCK_SHOW_IDS[(identityIndex += 1) % STOCK_SHOW_IDS.length])
  window.history.replaceState(null, '', `/studio/shows/${record.id}`)
  useShowStore.setState(showInitialState)
  let saved = structuredClone(record)
  const write = vi.fn(async (id: string, next: ShowRecordV2) => {
    if (options.failSave) throw new Error('save refused')
    await options.beforeSave?.(id, next)
    saved = structuredClone(next)
  })
  setPersonalContentProvider({
    ...getPersonalContentProvider(), id: 'mcp-v2-failure', replaceShowV2: write,
    listShowDocumentsV2: async () => [structuredClone(saved)],
  })
  usePatternStore.setState({ userPatterns: patterns, patternsLoaded: true } as never)
  useShowStore.setState({ showV2Pilots: { [record.id]: record }, showV2Histories: { [record.id]: { past: [], future: [] } } })
  const dependencies = { patterns, maps: [], libraries: [], profiles: [], stageMap: null }
  let capture = captureShowStageEditV2(record, dependencies)
  const unsubscribe = useShowStore.subscribe(() => {
    const current = useShowStore.getState().showV2Pilots[record.id]
    if (current && current !== capture.record) capture = captureShowStageEditV2(current, dependencies)
  })
  const admission = createAgentEditorAdmission(record.id, () => ({ playheadMs: 0 }), undefined, undefined, {
    capture: () => capture,
    isCurrentCapture: () => useShowStore.getState().showV2Pilots[record.id] === capture.record,
  })
  const session = createAgentBrowserSession({
    admission, showId: record.id,
    fetch: (async (_url: string, init: RequestInit) => {
      const response = await runtime.dispatchFetch('https://app.test/api/agent/channel?agent=1', {
        method: 'POST', headers: { Origin: 'https://app.test', 'Content-Type': 'application/json', Cookie: cookie },
        body: init.body as string,
      })
      return Response.json(await response.json())
    }) as unknown as typeof fetch,
  })
  const tool = async (name: string, args: object = {}) => {
    const response = await runtime.dispatchFetch('https://app.test/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    })
    return (await response.json() as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent
  }
  await session.ready
  await session.arm()
  const connected = await tool('get_connection')
  expect(connected.code).toBe('bound')
  // The relay requires the caller to have read the Show before it may begin one.
  const read = await tool('read_show', { binding_id: connected.binding_id as string })
  expect(read).toMatchObject({ code: 'read' })
  expect((read.show as ShowRecordV2).version).toBe(2)
  return {
    record, write, admission, session, tool, dependencies,
    capture: () => capture,
    binding_id: connected.binding_id as string,
    readSaved: () => saved,
    close: () => { session.close(); unsubscribe(); admission.close() },
    current: () => useShowStore.getState().showV2Pilots[record.id],
    history: () => useShowStore.getState().showV2Histories[record.id],
  }
}

it.each(showMcpReplacementCases)('qualifies MCP replacement: $name', async replacementCase => {
  const startedAt = performance.now()
  const editor = await boundEditor({ patterns: replacementCase.patterns })
  try {
    const read = await editor.tool('read_show', { binding_id: editor.binding_id })
    expect(read).toMatchObject({ code: 'read', show: editor.record })
    const before = structuredClone(editor.current())
    const replacement = replacementCase.buildShow(before.id)
    const inputBefore = structuredClone(replacement)
    expect(replacement.id).toBe(before.id)
    expect(replacement.name).not.toBe(before.name)
    expect(validateShowRecordV2(replacement)).toEqual([])

    const begun = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: replacementCase.name, idempotency_key: 'begin' })
    expect(begun.code).toBe('begun')
    const identity = { binding_id: editor.binding_id, operation_id: begun.operation_id as string }
    expect((await editor.tool('replace_show', { ...identity, idempotency_key: 'replace', show: replacement })).code).toBe('changed')
    expect(replacement).toEqual(inputBefore)
    expect(editor.current()).toEqual(before)
    expect(editor.readSaved()).toEqual(before)
    expect(editor.history().past).toEqual([])
    expect(editor.write).not.toHaveBeenCalled()

    expect((await editor.tool('commit_edit', { ...identity, idempotency_key: 'commit' })).code).toBe('outcome')
    await vi.waitFor(async () => {
      expect(await editor.tool('get_outcome', identity)).toMatchObject({ code: 'outcome', receipt: { status: 'applied', settlement: 'saved' } })
    })
    expect(editor.write).toHaveBeenCalledTimes(1)
    expect(editor.write.mock.calls[0][0]).toBe(before.id)
    expect(editor.history().past).toEqual([before])
    expect(editor.history().future).toEqual([])
    const current = editor.current()
    const saved = editor.readSaved()
    const expected = { ...inputBefore, name: before.name, updatedAt: current.updatedAt }
    expect(current).toEqual(expected)
    expect(saved).toEqual(expected)
    expect(current.id).toBe(before.id)
    expect(current.name).toBe(before.name)
    expect(current.updatedAt).toBeGreaterThan(before.updatedAt)
    expect(replacement).toEqual(inputBefore)
    expect(validateShowRecordV2(saved)).toEqual([])

    if (replacementCase.samples.length === 0) {
      const bundle = buildShowFileBundle(saved, { patterns: editor.dependencies.patterns, maps: [], libraries: [] }, { appVersion: 'mcp-v2', exportedAt: '2026-01-01T00:00:00.000Z' })
      const reopened = await parseShowFileBundle(await serializeShowFileBundle(bundle.bundle), { acceptV2: true })
      expect(reopened.version).toBe(2)
      expect(reopened.show).toEqual(saved)
      expect(prepareShowStageV2(saved, editor.dependencies)).toEqual({ status: 'empty', record: saved })
    } else {
      const artifacts = await nativeShowV2Artifacts(saved, editor.dependencies, replacementCase.mapPoints)
      const replay = artifacts.replay('fast')
      for (const sample of replacementCase.samples) {
        replay.advanceTo(sample.atMs, { stepMs: 1, forceFullIntermediateRender: true })
        // Snapshot JSON rounds linear RGB channels to four decimals.
        expect(encodeFastReplaySnapshot(replay.snapshot()).frame, `${replacementCase.name} RGB at ${sample.atMs} ms`).toEqual(sample.rgb)
      }
    }
    console.info(`MCP replacement ${replacementCase.name}: ${Math.round(performance.now() - startedAt)} ms`)
  } finally { editor.close() }
}, 120_000)

it('answers a duplicate begin key with the original operation and never opens a second candidate', async () => {
  const editor = await boundEditor()
  try {
    const begun = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: 'Rename', idempotency_key: 'begin' })
    expect(begun.code).toBe('begun')
    const repeat = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: 'Rename', idempotency_key: 'begin' })
    expect(repeat).toMatchObject({ code: 'begun', operation_id: begun.operation_id })
    const changed = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: 'A different intent', idempotency_key: 'begin' })
    expect(changed).toMatchObject({ code: 'identity_conflict', operation_id: begun.operation_id })
    expect(editor.write).not.toHaveBeenCalled()
  } finally { editor.close() }
}, 120_000)

it('replaces the connected Show through MCP and restores the prior composition in one Undo', async () => {
  const editor = await boundEditor()
  try {
    const before = structuredClone(editor.current())
    const replacement = structuredClone(before)
    replacement.name = 'Ignored input name'
    replacement.composition.layers[0].name = 'Agent replacement'
    expect(validateShowRecordV2(replacement)).toEqual([])
    const begun = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: 'Replace the composition', idempotency_key: 'begin' })
    const identity = { binding_id: editor.binding_id, operation_id: begun.operation_id as string }
    expect((await editor.tool('replace_show', { ...identity, idempotency_key: 'replace', show: replacement })).code).toBe('changed')
    expect(editor.current()).toEqual(before)
    expect((await editor.tool('commit_edit', { ...identity, idempotency_key: 'commit' })).code).toBe('outcome')
    await vi.waitFor(async () => {
      expect(await editor.tool('get_outcome', identity)).toMatchObject({ code: 'outcome', receipt: { status: 'applied', settlement: 'saved' } })
    })
    expect(editor.current()).toMatchObject({ id: before.id, name: before.name, composition: replacement.composition })
    expect(editor.history().past).toEqual([before])
    expect(editor.write).toHaveBeenCalledTimes(1)
    const saved = editor.readSaved()
    const bundle = buildShowFileBundle(saved, { patterns: [PATTERN], maps: [], libraries: [] }, { appVersion: 'mcp-v2', exportedAt: '2026-01-01T00:00:00.000Z' })
    const reopened = await parseShowFileBundle(await serializeShowFileBundle(bundle.bundle), { acceptV2: true })
    expect(reopened.show).toEqual(saved)
    expect(await useShowStore.getState().undoShowV2Pilot(before.id)).toBe(true)
    expect({ ...editor.current(), updatedAt: before.updatedAt }).toEqual(before)
    expect(editor.history().past).toEqual([])
  } finally { editor.close() }
}, 120_000)

it('refuses an unknown Pattern at commit without adopting a partial replacement', async () => {
  const editor = await boundEditor()
  try {
    const before = structuredClone(editor.current())
    const replacement = structuredClone(before)
    replacement.composition.patternInstances[0].pattern = { kind: 'user', id: 'missing-pattern' }
    expect(validateShowRecordV2(replacement)).toEqual([])
    const begun = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: 'Replace the composition', idempotency_key: 'begin' })
    const identity = { binding_id: editor.binding_id, operation_id: begun.operation_id as string }
    expect((await editor.tool('replace_show', { ...identity, idempotency_key: 'replace', show: replacement })).code).toBe('changed')
    expect((await editor.tool('commit_edit', { ...identity, idempotency_key: 'commit' })).code).toBe('outcome')
    expect(await editor.tool('get_outcome', identity)).toMatchObject({
      code: 'outcome', receipt: {
        status: 'refused', reason: 'invalid-candidate',
        diagnostic: { stage: 'authoring', issues: expect.arrayContaining([expect.objectContaining({ code: 'pattern-reference-unavailable' })]) },
      },
    })
    expect(editor.current()).toEqual(before)
    expect(editor.history().past).toEqual([])
    expect(editor.write).not.toHaveBeenCalled()
  } finally { editor.close() }
}, 120_000)

it('refuses a commit whose base revision a manual edit superseded, with no partial adoption', async () => {
  const editor = await boundEditor()
  try {
    const begun = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: 'Rename', idempotency_key: 'begin' })
    const identity = { binding_id: editor.binding_id, operation_id: begun.operation_id as string }
    expect((await editor.tool('rename_show', { ...identity, idempotency_key: 'rename', name: 'Renamed by command' })).code).toBe('changed')
    // A manual edit lands between the capture and the commit.
    const manual = await admitShowV2PilotSetShowEnd({
      showId: editor.record.id, baseRevision: useShowStore.getState().showRevisions[editor.record.id] ?? 0,
      capture: editor.capture(), isCurrent: () => true, onAdopted: () => {},
      intent: { kind: 'set-show-end', showEndMs: 25_000 },
    })
    expect(manual.status).toBe('applied')
    editor.write.mockClear()
    expect((await editor.tool('commit_edit', { ...identity, idempotency_key: 'commit' })).code).toBe('outcome')
    const outcome = await editor.tool('get_outcome', identity)
    expect(outcome).toMatchObject({ code: 'outcome', receipt: { status: 'refused', reason: 'revision-conflict' } })
    expect(editor.write).not.toHaveBeenCalled()
    expect(editor.current().name).toBe(editor.record.name)
    expect(editor.readSaved().composition.showEndMs).toBe(25_000)
  } finally { editor.close() }
}, 120_000)

it('reports a failed save as a rolled-back receipt with the record and history restored', async () => {
  const editor = await boundEditor({ failSave: true })
  try {
    const before = structuredClone(editor.current())
    const begun = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: 'Rename', idempotency_key: 'begin' })
    const identity = { binding_id: editor.binding_id, operation_id: begun.operation_id as string }
    expect((await editor.tool('rename_show', { ...identity, idempotency_key: 'rename', name: 'Renamed by command' })).code).toBe('changed')
    expect((await editor.tool('commit_edit', { ...identity, idempotency_key: 'commit' })).code).toBe('outcome')
    await vi.waitFor(async () => {
      expect(await editor.tool('get_outcome', identity)).toMatchObject({ code: 'outcome', receipt: { status: 'applied', settlement: 'rolled-back' } })
    })
    expect(editor.current()).toEqual(before)
    expect(editor.history().past).toEqual([])
    expect(useShowStore.getState().showV2SaveFailure?.showId).toBe(editor.record.id)
  } finally { editor.close() }
}, 120_000)

it('commits command A then replacement then B as one saved authored record', async () => {
  const startedAt = performance.now()
  const solid = showMcpReplacementCases[0]
  const editor = await boundEditor({ patterns: solid.patterns })
  try {
    const before = structuredClone(editor.current())
    const replacement = solid.buildShow(before.id)
    const input = structuredClone(replacement)
    const begun = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: 'Replace between commands', idempotency_key: 'begin-a-replace-b' })
    expect(begun.code).toBe('begun')
    const identity = { binding_id: editor.binding_id, operation_id: begun.operation_id as string }
    expect((await editor.tool('set_show_end', { ...identity, idempotency_key: 'command-a', end_ms: 30_000 })).code).toBe('changed')
    expect((await editor.tool('replace_show', { ...identity, idempotency_key: 'replacement', show: replacement })).code).toBe('changed')
    expect((await editor.tool('rename_show', { ...identity, idempotency_key: 'command-b', name: 'After replacement' })).code).toBe('changed')
    expect(editor.current()).toEqual(before)
    expect(editor.readSaved()).toEqual(before)
    expect(editor.history()).toEqual({ past: [], future: [] })
    expect(editor.write).not.toHaveBeenCalled()
    expect((await editor.tool('commit_edit', { ...identity, idempotency_key: 'commit-a-replace-b' })).code).toBe('outcome')
    await vi.waitFor(async () => expect(await editor.tool('get_outcome', identity)).toMatchObject({ code: 'outcome', receipt: { status: 'applied', settlement: 'saved' } }))
    const expected = { ...input, name: 'After replacement', updatedAt: editor.current().updatedAt }
    expect(expected.composition.showEndMs).toBe(1_000)
    expect(editor.current()).toEqual(expected)
    expect(editor.readSaved()).toEqual(expected)
    expect(editor.history()).toEqual({ past: [before], future: [] })
    expect(editor.write).toHaveBeenCalledTimes(1)
    expect(replacement).toEqual(input)
    const native = await nativeShowV2Artifacts(editor.readSaved(), editor.dependencies, solid.mapPoints)
    const bundle = buildShowFileBundle(editor.readSaved(), { patterns: editor.dependencies.patterns, maps: [], libraries: [] }, { appVersion: 'mcp-v2', exportedAt: '2026-01-01T00:00:00.000Z' })
    expect((await parseShowFileBundle(await serializeShowFileBundle(bundle.bundle), { acceptV2: true })).show).toEqual(expected)
    const replay = native.replay('fast')
    replay.advanceTo(250, { stepMs: 1, forceFullIntermediateRender: true })
    expect(encodeFastReplaySnapshot(replay.snapshot()).frame).toEqual([1, 0, 0])
    console.info(`MCP history A-replace-B: ${Math.round(performance.now() - startedAt)} ms`)
  } finally { editor.close() }
}, 120_000)

it('edits an introduced Clip after replacement, then Undo and Redo restore exact authored snapshots', async () => {
  const startedAt = performance.now()
  const solid = showMcpReplacementCases[0]
  const editor = await boundEditor({ patterns: solid.patterns })
  try {
    const original = structuredClone(editor.current())
    const replacement = solid.buildShow(original.id)
    const first = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: 'Introduce red Clip', idempotency_key: 'begin-replacement' })
    expect(first.code).toBe('begun')
    const firstIdentity = { binding_id: editor.binding_id, operation_id: first.operation_id as string }
    expect((await editor.tool('replace_show', { ...firstIdentity, idempotency_key: 'replace', show: replacement })).code).toBe('changed')
    expect((await editor.tool('commit_edit', { ...firstIdentity, idempotency_key: 'commit' })).code).toBe('outcome')
    await vi.waitFor(async () => expect(await editor.tool('get_outcome', firstIdentity)).toMatchObject({ receipt: { status: 'applied', settlement: 'saved' } }))
    const replaced = structuredClone(editor.current())
    expect(replaced).toEqual({ ...replacement, name: original.name, updatedAt: replaced.updatedAt })
    expect(editor.readSaved()).toEqual(replaced)
    expect(editor.history()).toEqual({ past: [original], future: [] })
    expect(editor.write).toHaveBeenCalledTimes(1)

    const read = await editor.tool('read_show', { binding_id: editor.binding_id })
    expect(read).toMatchObject({ code: 'read', show: replaced })
    const clipId = (read.show as ShowRecordV2).composition.clips[0].id
    expect(clipId).toBe('red-clip')
    const second = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: 'Dim introduced Clip', idempotency_key: 'begin-opacity' })
    expect(second.code).toBe('begun')
    const secondIdentity = { binding_id: editor.binding_id, operation_id: second.operation_id as string }
    expect((await editor.tool('update_clips', { ...secondIdentity, idempotency_key: 'opacity', updates: [{ clip_id: clipId, appearance: { apply: { scope: 'whole-clip' }, opacity: 0.5 } }] })).code).toBe('changed')
    expect((await editor.tool('commit_edit', { ...secondIdentity, idempotency_key: 'commit' })).code).toBe('outcome')
    await vi.waitFor(async () => expect(await editor.tool('get_outcome', secondIdentity)).toMatchObject({ receipt: { status: 'applied', settlement: 'saved' } }))
    const edited = structuredClone(editor.current())
    const expectedEdited = structuredClone(replaced)
    expectedEdited.updatedAt = edited.updatedAt
    expectedEdited.composition.clips[0].appearance!.keys[0].value.opacity = 0.5
    expect(edited).toEqual(expectedEdited)
    expect(editor.readSaved()).toEqual(edited)
    expect(editor.history()).toEqual({ past: [original, replaced], future: [] })
    expect(editor.write).toHaveBeenCalledTimes(2)

    expect(await useShowStore.getState().undoShowV2Pilot(original.id)).toBe(true)
    const undone = structuredClone(editor.current())
    expect(undone).toEqual({ ...replaced, updatedAt: undone.updatedAt })
    expect(editor.readSaved()).toEqual(undone)
    expect(editor.history()).toEqual({ past: [original], future: [edited] })
    expect(editor.write).toHaveBeenCalledTimes(3)
    expect(await useShowStore.getState().redoShowV2Pilot(original.id)).toBe(true)
    const redone = structuredClone(editor.current())
    expect(redone).toEqual({ ...edited, updatedAt: redone.updatedAt })
    expect(editor.readSaved()).toEqual(redone)
    expect(editor.history()).toEqual({ past: [original, undone], future: [] })
    expect(editor.write).toHaveBeenCalledTimes(4)
    const native = await nativeShowV2Artifacts(editor.readSaved(), editor.dependencies, solid.mapPoints)
    const bundle = buildShowFileBundle(editor.readSaved(), { patterns: editor.dependencies.patterns, maps: [], libraries: [] }, { appVersion: 'mcp-v2', exportedAt: '2026-01-01T00:00:00.000Z' })
    expect((await parseShowFileBundle(await serializeShowFileBundle(bundle.bundle), { acceptV2: true })).show).toEqual(redone)
    const replay = native.replay('fast')
    replay.advanceTo(250, { stepMs: 1, forceFullIntermediateRender: true })
    expect(encodeFastReplaySnapshot(replay.snapshot()).frame).toEqual([0.5, 0, 0])
    console.info(`MCP history introduced Clip Undo Redo: ${Math.round(performance.now() - startedAt)} ms`)
  } finally { editor.close() }
}, 120_000)

it('shares a duplicated Clip runtime, then makes the copy independent before editing its control', async () => {
  const startedAt = performance.now()
  const editor = await boundEditor({ patterns: [showMcpGainPattern] })
  try {
    const original = structuredClone(editor.current())
    const replacement = showMcpGainReplacement(original.id)
    expect(validateShowRecordV2(replacement)).toEqual([])
    const first = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: 'Gain replacement', idempotency_key: 'begin-gain' })
    const firstId = { binding_id: editor.binding_id, operation_id: first.operation_id as string }
    expect((await editor.tool('replace_show', { ...firstId, idempotency_key: 'replace-gain', show: replacement })).code).toBe('changed')
    expect((await editor.tool('commit_edit', { ...firstId, idempotency_key: 'commit-gain' })).code).toBe('outcome')
    await vi.waitFor(async () => expect(await editor.tool('get_outcome', firstId)).toMatchObject({ receipt: { status: 'applied', settlement: 'saved' } }))
    const replaced = structuredClone(editor.current())
    expect(replaced).toEqual({ ...replacement, name: original.name, updatedAt: replaced.updatedAt })
    expect(editor.history().past).toEqual([original])
    expect(editor.write).toHaveBeenCalledTimes(1)

    expect(await editor.tool('read_show', { binding_id: editor.binding_id })).toMatchObject({ code: 'read', show: replaced })
    const duplicate = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: 'Share red runtime', idempotency_key: 'begin-duplicate' })
    const duplicateId = { binding_id: editor.binding_id, operation_id: duplicate.operation_id as string }
    const copied = await editor.tool('duplicate_clip', { ...duplicateId, idempotency_key: 'duplicate', clip_id: 'red-clip', start_ms: 500 })
    expect(copied.code).toBe('changed')
    const copyId = (copied.changes as Array<{ details: { clips: string[] } }>).flatMap(change => change.details.clips).find(id => id !== 'red-clip')!
    expect(copyId).toBeTruthy()
    expect((await editor.tool('commit_edit', { ...duplicateId, idempotency_key: 'commit-duplicate' })).code).toBe('outcome')
    await vi.waitFor(async () => expect(await editor.tool('get_outcome', duplicateId)).toMatchObject({ receipt: { status: 'applied', settlement: 'saved' } }))
    const shared = structuredClone(editor.current())
    expect(shared.composition.clips.map(clip => [clip.id, clip.startMs, clip.durationMs])).toEqual([['red-clip', 0, 500], [copyId, 500, 500]])
    expect(shared.composition.clips[0].instanceId).toBe(shared.composition.clips[1].instanceId)
    expect(shared.composition.patternInstances).toEqual(replaced.composition.patternInstances)
    expect(editor.readSaved()).toEqual(shared)
    expect(editor.history().past).toEqual([original, replaced])
    expect(editor.write).toHaveBeenCalledTimes(2)
    const sharedNative = await nativeShowV2Artifacts(editor.readSaved(), editor.dependencies)
    expect(sharedNative.importedShow.composition).toEqual(shared.composition)
    const sharedBundle = buildShowFileBundle(editor.readSaved(), { patterns: editor.dependencies.patterns, maps: [], libraries: [] }, { appVersion: 'mcp-v2', exportedAt: '2026-01-01T00:00:00.000Z' })
    expect((await parseShowFileBundle(await serializeShowFileBundle(sharedBundle.bundle), { acceptV2: true })).show).toEqual(shared)

    expect(await editor.tool('read_show', { binding_id: editor.binding_id })).toMatchObject({ code: 'read', show: shared })
    const control = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: 'Raise shared gain', idempotency_key: 'begin-shared-control' })
    const controlId = { binding_id: editor.binding_id, operation_id: control.operation_id as string }
    expect((await editor.tool('update_clips', { ...controlId, idempotency_key: 'shared-control', updates: [{ clip_id: 'red-clip', instance_properties: { controls: { sliderGain: 0.5 } } }] })).code).toBe('changed')
    expect((await editor.tool('commit_edit', { ...controlId, idempotency_key: 'commit-shared-control' })).code).toBe('outcome')
    await vi.waitFor(async () => expect(await editor.tool('get_outcome', controlId)).toMatchObject({ receipt: { status: 'applied', settlement: 'saved' } }))
    const raised = structuredClone(editor.current())
    const expectedRaised = structuredClone(shared)
    expectedRaised.updatedAt = raised.updatedAt
    expectedRaised.composition.patternInstances[0].controlTargets = { sliderGain: 0.5 }
    expect(raised).toEqual(expectedRaised)
    expect(editor.readSaved()).toEqual(raised)
    expect(editor.history().past).toEqual([original, replaced, shared])
    expect(editor.write).toHaveBeenCalledTimes(3)
    const raisedReplay = (await nativeShowV2Artifacts(raised, editor.dependencies)).replay('fast')
    for (const atMs of [250, 750]) {
      raisedReplay.advanceTo(atMs, { stepMs: 1, forceFullIntermediateRender: true })
      expect(encodeFastReplaySnapshot(raisedReplay.snapshot()).frame).toEqual([0.5, 0, 0])
    }

    expect(await editor.tool('read_show', { binding_id: editor.binding_id })).toMatchObject({ code: 'read', show: raised })
    const independent = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: 'Fork copied Pattern and raise its gain', idempotency_key: 'begin-independent' })
    const independentId = { binding_id: editor.binding_id, operation_id: independent.operation_id as string }
    expect((await editor.tool('make_clip_pattern_independent', { ...independentId, idempotency_key: 'independent', clip_id: copyId })).code).toBe('changed')
    expect((await editor.tool('update_clips', { ...independentId, idempotency_key: 'copy-control', updates: [{ clip_id: copyId, instance_properties: { controls: { sliderGain: 0.75 } } }] })).code).toBe('changed')
    expect(editor.current()).toEqual(raised)
    expect(editor.readSaved()).toEqual(raised)
    expect(editor.history().past).toEqual([original, replaced, shared])
    expect(editor.write).toHaveBeenCalledTimes(3)
    expect((await editor.tool('commit_edit', { ...independentId, idempotency_key: 'commit-independent' })).code).toBe('outcome')
    await vi.waitFor(async () => expect(await editor.tool('get_outcome', independentId)).toMatchObject({ receipt: { status: 'applied', settlement: 'saved' } }))
    const finalRecord = structuredClone(editor.current())
    const copyInstanceId = finalRecord.composition.clips.find(clip => clip.id === copyId)!.instanceId
    expect(copyInstanceId).not.toBe(raised.composition.clips[0].instanceId)
    const expectedFinal = structuredClone(raised)
    expectedFinal.updatedAt = finalRecord.updatedAt
    expectedFinal.composition.clips.find(clip => clip.id === copyId)!.instanceId = copyInstanceId
    expectedFinal.composition.patternInstances.push({ ...raised.composition.patternInstances[0], id: copyInstanceId, controlTargets: { sliderGain: 0.75 } })
    expect(finalRecord).toEqual(expectedFinal)
    expect(finalRecord.composition.clips[0]).toEqual(raised.composition.clips[0])
    expect(finalRecord.composition.patternInstances[0]).toEqual(raised.composition.patternInstances[0])
    expect(finalRecord.composition.patternInstances).toHaveLength(2)
    expect(finalRecord.composition.patternInstances.map(instance => instance.pattern)).toEqual([{ kind: 'user', id: 'mcp-gain' }, { kind: 'user', id: 'mcp-gain' }])
    expect(editor.readSaved()).toEqual(finalRecord)
    expect(editor.history().past).toEqual([original, replaced, shared, raised])
    expect(editor.write).toHaveBeenCalledTimes(4)
    const native = await nativeShowV2Artifacts(editor.readSaved(), editor.dependencies)
    const bundle = buildShowFileBundle(editor.readSaved(), { patterns: editor.dependencies.patterns, maps: [], libraries: [] }, { appVersion: 'mcp-v2', exportedAt: '2026-01-01T00:00:00.000Z' })
    expect((await parseShowFileBundle(await serializeShowFileBundle(bundle.bundle), { acceptV2: true })).show).toEqual(finalRecord)
    const replay = native.replay('fast')
    for (const [atMs, red] of [[250, 0.5], [750, 0.75]]) {
      replay.advanceTo(atMs, { stepMs: 1, forceFullIntermediateRender: true })
      expect(encodeFastReplaySnapshot(replay.snapshot()).frame).toEqual([red, 0, 0])
    }
    console.info(`MCP history shared-independent controls: ${Math.round(performance.now() - startedAt)} ms`)
  } finally { editor.close() }
}, 120_000)

it('moves a Group occurrence before its authored restart and preserves exported elapsed across a Layout switch', async () => {
  const startedAt = performance.now()
  const fixture = showV2LayoutEditorFixture()
  const editor = await boundEditor({ patterns: fixture.dependencies.patterns })
  try {
    const original = structuredClone(editor.current())
    const replacement = structuredClone(fixture.record)
    replacement.id = original.id
    expect(validateShowRecordV2(replacement)).toEqual([])
    const first = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: 'Adopt held Group', idempotency_key: 'begin-group' })
    const firstId = { binding_id: editor.binding_id, operation_id: first.operation_id as string }
    expect((await editor.tool('replace_show', { ...firstId, idempotency_key: 'replace-group', show: replacement })).code).toBe('changed')
    expect((await editor.tool('commit_edit', { ...firstId, idempotency_key: 'commit-group' })).code).toBe('outcome')
    await vi.waitFor(async () => expect(await editor.tool('get_outcome', firstId)).toMatchObject({ receipt: { status: 'applied', settlement: 'saved' } }))
    const replaced = structuredClone(editor.current())
    expect(replaced).toEqual({ ...replacement, name: original.name, updatedAt: replaced.updatedAt })
    expect(editor.readSaved()).toEqual(replaced)
    expect(editor.history().past).toEqual([original])
    expect(editor.write).toHaveBeenCalledTimes(1)

    expect(await editor.tool('read_show', { binding_id: editor.binding_id })).toMatchObject({ code: 'read', show: replaced })
    const occurrence = replaced.composition.groupOccurrences[0]
    expect(occurrence.startMs).toBe(2_000)
    const second = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: 'Move held Group', idempotency_key: 'begin-move-group' })
    const secondId = { binding_id: editor.binding_id, operation_id: second.operation_id as string }
    const move = await editor.tool('move_group_occurrence', { ...secondId, idempotency_key: 'move-group', group_occurrence_id: occurrence.id, start_ms: 2_500 })
    expect(move.code).toBe('changed')
    expect((await editor.tool('commit_edit', { ...secondId, idempotency_key: 'commit-move-group' })).code).toBe('outcome')
    await vi.waitFor(async () => expect(await editor.tool('get_outcome', secondId)).toMatchObject({ receipt: { status: 'applied', settlement: 'saved' } }))
    const moved = structuredClone(editor.current())
    const expectedMoved = structuredClone(replaced)
    expectedMoved.updatedAt = moved.updatedAt
    expectedMoved.composition.groupOccurrences[0].startMs = 2_500
    expect(moved).toEqual(expectedMoved)
    expect(moved.composition.groupDefinitions).toEqual(replaced.composition.groupDefinitions)
    expect(moved.composition.groupOccurrences[0].layerBindings).toEqual(occurrence.layerBindings)
    expect(moved.composition.patternInstances).toEqual(replaced.composition.patternInstances)
    expect(moved.composition.layoutOccurrences.map(item => [item.startMs, item.durationMs])).toEqual([[0, 5_000], [5_000, 26_000]])
    expect(moved.composition.groupOccurrences[0].layoutOccurrenceId).toBe(occurrence.layoutOccurrenceId)
    expect(editor.readSaved()).toEqual(moved)
    expect(editor.history()).toEqual({ past: [original, replaced], future: [] })
    expect(editor.write).toHaveBeenCalledTimes(2)
    const native = await nativeShowV2Artifacts(editor.readSaved(), editor.dependencies)
    const bundle = buildShowFileBundle(editor.readSaved(), { patterns: editor.dependencies.patterns, maps: [], libraries: [] }, { appVersion: 'mcp-v2', exportedAt: '2026-01-01T00:00:00.000Z' })
    expect((await parseShowFileBundle(await serializeShowFileBundle(bundle.bundle), { acceptV2: true })).show).toEqual(moved)
    const authored = native.members.filter(member => !member.id.startsWith('__pxlblz_'))
    expect(authored).toHaveLength(1)
    const replay = native.replay('fast')
    const elapsed = (atMs: number) => exportedScalar(replay.advanceTo(atMs, { stepMs: 250, forceFullIntermediateRender: true }).exports, `${authored[0].prefix}_elapsed`, 'fast')
    const beforeSwitch = elapsed(4_750)
    expect(elapsed(5_250) - beforeSwitch).toBe(500)
    console.info(`MCP history Group Layout: ${Math.round(performance.now() - startedAt)} ms`)
  } finally { editor.close() }
}, 120_000)

it.each(['commit', 'cancel'] as const)('keeps private replacement after invalid input, then corrects and %s', async disposition => {
  const startedAt = performance.now()
  const solid = showMcpReplacementCases[0]
  const editor = await boundEditor({ patterns: solid.patterns })
  try {
    const before = structuredClone(editor.current())
    const replacement = solid.buildShow(before.id)
    const corrected = structuredClone(replacement)
    corrected.composition.clips[0].appearance!.keys[0].value.opacity = 0.5
    const begun = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: `Correct then ${disposition}`, idempotency_key: 'begin-correction' })
    expect(begun.code).toBe('begun')
    const identity = { binding_id: editor.binding_id, operation_id: begun.operation_id as string }
    expect((await editor.tool('replace_show', { ...identity, idempotency_key: 'valid', show: replacement })).code).toBe('changed')
    const invalid = await editor.tool('replace_show', { ...identity, idempotency_key: 'invalid', show: { ...replacement, version: 1 } })
    expect(invalid).toMatchObject({ code: 'refused', reason: 'invalid-show-record', issues: expect.any(Array) })
    expect((invalid.issues as unknown[]).length).toBeGreaterThan(0)
    expect(editor.current()).toEqual(before)
    expect(editor.readSaved()).toEqual(before)
    expect(editor.history()).toEqual({ past: [], future: [] })
    expect(editor.write).not.toHaveBeenCalled()
    expect((await editor.tool('replace_show', { ...identity, idempotency_key: 'retry-valid', show: replacement })).code).toBe('unchanged')
    expect((await editor.tool('replace_show', { ...identity, idempotency_key: 'corrected', show: corrected })).code).toBe('changed')
    if (disposition === 'commit') {
      expect((await editor.tool('commit_edit', { ...identity, idempotency_key: 'commit-corrected' })).code).toBe('outcome')
      await vi.waitFor(async () => expect(await editor.tool('get_outcome', identity)).toMatchObject({ receipt: { status: 'applied', settlement: 'saved' } }))
      const expected = { ...corrected, name: before.name, updatedAt: editor.current().updatedAt }
      expect(editor.current()).toEqual(expected)
      expect(editor.readSaved()).toEqual(expected)
      expect(editor.history()).toEqual({ past: [before], future: [] })
      expect(editor.write).toHaveBeenCalledTimes(1)
      const native = await nativeShowV2Artifacts(editor.readSaved(), editor.dependencies, solid.mapPoints)
      const bundle = buildShowFileBundle(editor.readSaved(), { patterns: editor.dependencies.patterns, maps: [], libraries: [] }, { appVersion: 'mcp-v2', exportedAt: '2026-01-01T00:00:00.000Z' })
      expect((await parseShowFileBundle(await serializeShowFileBundle(bundle.bundle), { acceptV2: true })).show).toEqual(expected)
      const replay = native.replay('fast')
      replay.advanceTo(250, { stepMs: 1, forceFullIntermediateRender: true })
      expect(encodeFastReplaySnapshot(replay.snapshot()).frame).toEqual([0.5, 0, 0])
    } else {
      expect(await editor.tool('cancel_edit', { ...identity, idempotency_key: 'cancel-corrected' })).toMatchObject({ code: 'outcome', receipt: { status: 'cancelled' } })
      expect(editor.current()).toEqual(before)
      expect(editor.readSaved()).toEqual(before)
      expect(editor.history()).toEqual({ past: [], future: [] })
      expect(editor.write).not.toHaveBeenCalled()
    }
    console.info(`MCP history invalid corrected ${disposition}: ${Math.round(performance.now() - startedAt)} ms`)
  } finally { editor.close() }
}, 120_000)

it('refuses a stale replacement after manual Show End admission without changing manual state', async () => {
  const startedAt = performance.now()
  const solid = showMcpReplacementCases[0]
  const editor = await boundEditor({ patterns: solid.patterns })
  try {
    const before = structuredClone(editor.current())
    const replacement = solid.buildShow(before.id)
    const begun = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: 'Replace before manual edit', idempotency_key: 'begin-stale-replacement' })
    const identity = { binding_id: editor.binding_id, operation_id: begun.operation_id as string }
    expect((await editor.tool('replace_show', { ...identity, idempotency_key: 'replace', show: replacement })).code).toBe('changed')
    const manual = await admitShowV2PilotSetShowEnd({
      showId: before.id, baseRevision: useShowStore.getState().showRevisions[before.id] ?? 0,
      capture: editor.capture(), isCurrent: () => true, onAdopted: () => {},
      intent: { kind: 'set-show-end', showEndMs: 25_000 },
    })
    expect(manual.status).toBe('applied')
    await vi.waitFor(() => expect(editor.write).toHaveBeenCalledTimes(1))
    const manualRecord = structuredClone(editor.current())
    const manualSaved = structuredClone(editor.readSaved())
    const manualHistory = structuredClone(editor.history())
    expect(manualRecord.composition.showEndMs).toBe(25_000)
    expect(manualRecord).toEqual(manualSaved)
    expect(manualHistory).toEqual({ past: [before], future: [] })
    expect((await editor.tool('commit_edit', { ...identity, idempotency_key: 'commit-stale' })).code).toBe('outcome')
    expect(await editor.tool('get_outcome', identity)).toMatchObject({ receipt: { status: 'refused', reason: 'revision-conflict' } })
    expect(editor.current()).toEqual(manualRecord)
    expect(editor.readSaved()).toEqual(manualSaved)
    expect(editor.history()).toEqual(manualHistory)
    expect(editor.write).toHaveBeenCalledTimes(1)
    console.info(`MCP history stale manual: ${Math.round(performance.now() - startedAt)} ms`)
  } finally { editor.close() }
}, 120_000)

it('replays keyed replacement and commit without duplicating one adoption', async () => {
  const startedAt = performance.now()
  const solid = showMcpReplacementCases[0]
  const editor = await boundEditor({ patterns: solid.patterns })
  try {
    const before = structuredClone(editor.current())
    const replacement = solid.buildShow(before.id)
    const changedPayload = structuredClone(replacement)
    changedPayload.composition.clips[0].appearance!.keys[0].value.opacity = 0.5
    const begun = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: 'Keyed replacement', idempotency_key: 'begin-keyed' })
    const identity = { binding_id: editor.binding_id, operation_id: begun.operation_id as string }
    const args = { ...identity, idempotency_key: 'fixed-replace', show: replacement }
    const first = await editor.tool('replace_show', args)
    expect(first.code).toBe('changed')
    expect(await editor.tool('replace_show', args)).toEqual(first)
    expect(await editor.tool('replace_show', { ...args, show: changedPayload })).toMatchObject({ code: 'identity_conflict' })
    expect(editor.current()).toEqual(before)
    expect(editor.history()).toEqual({ past: [], future: [] })
    expect(editor.write).not.toHaveBeenCalled()
    const committed = await editor.tool('commit_edit', { ...identity, idempotency_key: 'fixed-commit' })
    expect(committed.code).toBe('outcome')
    await vi.waitFor(async () => expect(await editor.tool('get_outcome', identity)).toMatchObject({ receipt: { status: 'applied', settlement: 'saved' } }))
    const receipt = await editor.tool('get_outcome', identity)
    const repeated = await editor.tool('commit_edit', { ...identity, idempotency_key: 'fixed-commit' })
    expect(repeated).toEqual(committed)
    expect(receipt).toMatchObject({ receipt: { status: 'applied', settlement: 'saved' } })
    const expected = { ...replacement, name: before.name, updatedAt: editor.current().updatedAt }
    expect(editor.current()).toEqual(expected)
    expect(editor.readSaved()).toEqual(expected)
    expect(editor.history()).toEqual({ past: [before], future: [] })
    expect(editor.write).toHaveBeenCalledTimes(1)
    console.info(`MCP history keyed retries: ${Math.round(performance.now() - startedAt)} ms`)
  } finally { editor.close() }
}, 120_000)

it('rolls back a failed replacement save to its exact original record and history', async () => {
  const startedAt = performance.now()
  const solid = showMcpReplacementCases[0]
  const editor = await boundEditor({ failSave: true, patterns: solid.patterns })
  try {
    const before = structuredClone(editor.current())
    const replacement = solid.buildShow(before.id)
    const begun = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: 'Replacement with failed save', idempotency_key: 'begin-rollback' })
    const identity = { binding_id: editor.binding_id, operation_id: begun.operation_id as string }
    expect((await editor.tool('replace_show', { ...identity, idempotency_key: 'replace', show: replacement })).code).toBe('changed')
    expect((await editor.tool('commit_edit', { ...identity, idempotency_key: 'commit' })).code).toBe('outcome')
    await vi.waitFor(async () => expect(await editor.tool('get_outcome', identity)).toMatchObject({ receipt: { status: 'applied', settlement: 'rolled-back' } }))
    expect(editor.current()).toEqual(before)
    expect(editor.readSaved()).toEqual(before)
    expect(editor.history()).toEqual({ past: [], future: [] })
    expect(editor.write).toHaveBeenCalledTimes(1)
    expect(useShowStore.getState().showV2SaveFailure).toMatchObject({ showId: before.id })
    console.info(`MCP history replacement rollback: ${Math.round(performance.now() - startedAt)} ms`)
  } finally { editor.close() }
}, 120_000)

it('settles an older failed MCP replacement as superseded by a newer manual save', async () => {
  const startedAt = performance.now()
  let rejectFirst: ((reason: Error) => void) | undefined
  const firstWrite = new Promise<void>((_resolve, reject) => { rejectFirst = reject })
  void firstWrite.catch(() => {})
  let attempts = 0
  const solid = showMcpReplacementCases[0]
  const editor = await boundEditor({ patterns: solid.patterns, beforeSave: async () => {
    if (++attempts === 1) await firstWrite
  } })
  try {
    const before = structuredClone(editor.current())
    const replacement = solid.buildShow(before.id)
    const begun = await editor.tool('begin_edit', { binding_id: editor.binding_id, intent: 'Superseded replacement', idempotency_key: 'begin-superseded' })
    const identity = { binding_id: editor.binding_id, operation_id: begun.operation_id as string }
    expect((await editor.tool('replace_show', { ...identity, idempotency_key: 'replace', show: replacement })).code).toBe('changed')
    expect((await editor.tool('commit_edit', { ...identity, idempotency_key: 'commit' })).code).toBe('outcome')
    await vi.waitFor(() => expect(editor.write).toHaveBeenCalledTimes(1))
    const adopted = structuredClone(editor.current())
    expect(adopted).toEqual({ ...replacement, name: before.name, updatedAt: adopted.updatedAt })
    expect(editor.readSaved()).toEqual(before)
    expect(editor.history()).toEqual({ past: [before], future: [] })
    const newer = structuredClone(adopted)
    newer.name = 'Newer'
    const laterSave = useShowStore.getState().updateShowV2Pilot(before.id, newer)
    const currentNewer = structuredClone(editor.current())
    expect(currentNewer).toEqual({ ...newer, updatedAt: currentNewer.updatedAt })
    rejectFirst!(new Error('older failed'))
    rejectFirst = undefined
    await laterSave
    await vi.waitFor(async () => expect(await editor.tool('get_outcome', identity)).toMatchObject({ receipt: { status: 'applied', settlement: 'superseded' } }))
    expect(editor.current()).toEqual(currentNewer)
    expect(editor.readSaved()).toEqual(currentNewer)
    expect(editor.history()).toEqual({ past: [before, adopted], future: [] })
    expect(editor.write).toHaveBeenCalledTimes(2)
    expect(attempts).toBe(2)
    expect(useShowStore.getState().showV2SaveFailure).toBeNull()
    console.info(`MCP history superseded save: ${Math.round(performance.now() - startedAt)} ms`)
  } finally {
    rejectFirst?.(new Error('test cleanup'))
    editor.close()
  }
}, 120_000)
