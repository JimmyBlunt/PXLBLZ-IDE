import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page, TestInfo } from '@playwright/test'
import type { ShowRecordV2 } from '../src/engine/showCompositionV2'
import { changedPixelsBetween, measuredExact, samplesAt, type Rgba, type RgbaImage } from '../src/test/showCapturePixelEvidence'
import { showMcpReplacementCases } from '../src/test/showMcpReplacementFixtures'
import { expect, test } from './fixtures/authenticated'
import { squareWorkspaceShow } from './fixtures/showWorkspace'
import { findStoredShowV2, seedShowV2 } from './support/showBackingRecords'
import { connectShowMcp, type ShowMcpClient } from './support/agentMcpClient'

const evidenceDirectory = join(process.cwd(), 'docs/reference/evidence/issue-1160-mcp-browser')
const previewSettings = { isRunning: false, fidelity: 'fast', speed: 1, brightness: 1, lightSize: 0.5, diffusion: 0 } as const
const red: Rgba = [255, 0, 0, 255]
const green: Rgba = [0, 255, 0, 255]
const solidCase = showMcpReplacementCases[0]
const zoneCase = showMcpReplacementCases[3]

interface CaptureWindow extends Window {
  __pxlblzShow?: {
    showId: string
    setPreview(settings: typeof previewSettings): void
    captureSequence(options: { frames: number; fps: number; startMs: number; prefix: string }): Promise<{
      frames: number; startMs: number; names: string[]; failures: Array<{ name: string; error: string }>
    }>
  }
}

function solidShow(id: string): ShowRecordV2 {
  const show = solidCase.buildShow(id)
  if (show.outputContract.kind !== 'portable-2d') throw new Error('Solid fixture must have portable 2D output')
  show.stageMapId = 'plane'
  show.outputContract.referencePixelCount = 1024
  show.zones[0].nominalPixelCount = 1024
  return show
}

function swappingZoneShow(id: string): ShowRecordV2 {
  const show = zoneCase.buildShow(id)
  if (show.outputContract.kind !== 'portable-2d') throw new Error('Zone fixture must have portable 2D output')
  show.stageMapId = 'plane'
  show.outputContract.referencePixelCount = 1024
  for (const zone of show.zones) zone.nominalPixelCount = 512
  const [leftRed, rightGreen] = show.composition.clips
  leftRed.durationMs = 500
  rightGreen.durationMs = 500
  show.composition.clips.push({
    ...structuredClone(leftRed), id: 'left-green-clip', instanceId: 'green-instance', startMs: 500,
    appearance: { keys: [{ ...structuredClone(leftRed.appearance.keys[0]), id: 'left-green-appearance', timeMs: 500 }] },
  }, {
    ...structuredClone(rightGreen), id: 'right-red-clip', instanceId: 'red-instance', startMs: 500,
    appearance: { keys: [{ ...structuredClone(rightGreen.appearance.keys[0]), id: 'right-red-appearance', timeMs: 500 }] },
  })
  return show
}

function greenShow(id: string): ShowRecordV2 {
  const show = solidShow(id)
  show.composition.patternInstances[0].pattern = { kind: 'user', id: 'mcp-green' }
  show.composition.patternInstances[0].patternName = 'Solid green'
  show.composition.layers[0].name = 'Green'
  return show
}

async function seed(page: Page, id: string, name: string): Promise<ShowRecordV2> {
  const show = await seedShowV2(page, { ...squareWorkspaceShow(1), id, name }, name)
  for (const pattern of zoneCase.patterns) {
    const response = await page.context().request.post('/api/patterns', { data: pattern })
    expect(response.ok(), `POST /api/patterns/${pattern.id}: HTTP ${response.status()}`).toBe(true)
  }
  return show
}

async function openEditor(page: Page, show: ShowRecordV2): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`studio/shows/${show.id}?capture`)
  await expect(page.getByRole('button', { name: 'Show properties', exact: true })).toBeVisible()
  await expect(page.getByRole('treeitem', { name: show.name, exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('show-stage-canvas-frame')).toHaveAttribute('aria-busy', 'false')
  await page.waitForFunction(id => (window as CaptureWindow).__pxlblzShow?.showId === id, show.id)
  expect(await page.evaluate(() => (window as CaptureWindow).__pxlblzShow?.showId)).toBe(show.id)
  await page.evaluate(settings => (window as CaptureWindow).__pxlblzShow!.setPreview(settings), previewSettings)
}

async function armDrawer(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Open the Agent drawer/ }).click()
  await page.getByRole('button', { name: 'Connect your agent with MCP' }).click()
  const drawer = page.getByRole('complementary', { name: 'Agent drawer', exact: true })
  await expect(drawer.getByRole('button', { name: 'Ready to connect' })).toBeVisible()
  await drawer.getByRole('button', { name: 'Ready to connect' }).click()
  await expect(drawer.getByRole('button', { name: 'Cancel connection attempt' })).toBeVisible()
}

async function boundClient(page: Page, show: ShowRecordV2): Promise<ShowMcpClient> {
  await armDrawer(page)
  const client = await connectShowMcp(page, show.id)
  const drawer = page.getByRole('complementary', { name: 'Agent drawer', exact: true })
  await expect(drawer.getByRole('img', { name: 'Connected' })).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible()
  const read = await client.tool('read_show', { binding_id: client.bindingId })
  expect(read).toMatchObject({ code: 'read', show: { id: show.id, name: show.name } })
  return client
}

async function replace(client: ShowMcpClient, candidate: ShowRecordV2, intent: string): Promise<Record<string, unknown>> {
  const current = await client.tool('read_show', { binding_id: client.bindingId })
  expect(current).toMatchObject({ code: 'read', show: { id: candidate.id } })
  const begun = await client.tool('begin_edit', { binding_id: client.bindingId, intent, idempotency_key: randomUUID() })
  expect(begun.code).toBe('begun')
  expect(typeof begun.operation_id).toBe('string')
  const identity = { binding_id: client.bindingId, operation_id: begun.operation_id as string }
  expect((await client.tool('replace_show', { ...identity, idempotency_key: randomUUID(), show: candidate })).code).toBe('changed')
  expect((await client.tool('commit_edit', { ...identity, idempotency_key: randomUUID() })).code).toBe('outcome')
  await expect.poll(async () => (await client.tool('get_outcome', identity)).receipt).toMatchObject({ status: 'applied', settlement: 'saved' })
  return identity
}

function expectedStored(candidate: ShowRecordV2, original: ShowRecordV2, actual: ShowRecordV2): ShowRecordV2 {
  return { ...candidate, id: original.id, name: original.name, updatedAt: actual.updatedAt }
}

async function assertStored(page: Page, original: ShowRecordV2, candidate: ShowRecordV2): Promise<ShowRecordV2> {
  await expect.poll(async () => {
    const actual = await findStoredShowV2(page, original.id)
    return actual && { ...actual, updatedAt: 0 }
  }).toEqual({ ...candidate, id: original.id, name: original.name, updatedAt: 0 })
  const stored = await findStoredShowV2(page, original.id)
  expect(stored).toBeDefined()
  expect(stored).toEqual(expectedStored(candidate, original, stored!))
  return stored!
}

interface CaptureEvidence {
  name: string
  timeMs: number
  path: string
  sha256: string
  bytes: number
  width: number
  height: number
  positions: Array<{ x: number; y: number; rgba: Rgba }>
  image: RgbaImage
}

function centres(image: RgbaImage) {
  return [
    { x: Math.round((8.5 / 32) * image.width), y: Math.round((16.5 / 32) * image.height) },
    { x: Math.round((24.5 / 32) * image.width), y: Math.round((16.5 / 32) * image.height) },
  ]
}

function assertSamples(capture: CaptureEvidence, colors: readonly [Rgba, Rgba]): void {
  const samples = samplesAt(capture.image, centres(capture.image))
  expect(samples, `32x32 declared grid centres on ${capture.width}x${capture.height} canvas`).toHaveLength(2)
  expect(samples.map(sample => sample.rgba), `${capture.name} at ${capture.timeMs} ms; canvas ${capture.width}x${capture.height}`).toEqual(colors)
}

function captureHarness(page: Page, testInfo: TestInfo, prefix: string) {
  const written = new Map<string, string>()
  const captures: CaptureEvidence[] = []
  let captureMs = 0
  const install = async () => {
    await page.route('**/__capture?name=*', async route => {
      const name = new URL(route.request().url()).searchParams.get('name')
      if (!name || !new RegExp(`^${prefix}-[a-z0-9-]+-00000\\.png$`).test(name)) throw new Error(`Unexpected capture name: ${name}`)
      const bytes = route.request().postDataBuffer()
      if (!bytes || bytes.length === 0) throw new Error(`Empty canvas capture: ${name}`)
      const path = testInfo.outputPath(name)
      await writeFile(path, bytes)
      written.set(name, path)
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, path, bytes: bytes.length }) })
    })
  }
  const capture = async (label: string, timeMs: number): Promise<CaptureEvidence> => {
    const start = performance.now()
    await expect(page.getByTestId('show-stage-canvas-frame')).toHaveAttribute('aria-busy', 'false')
    const result = await page.evaluate(async ({ startMs, namePrefix }) => (window as CaptureWindow).__pxlblzShow!.captureSequence({ frames: 1, fps: 1000, startMs, prefix: namePrefix }), {
      startMs: timeMs, namePrefix: `${prefix}-${label}`,
    })
    expect(result).toMatchObject({ frames: 1, startMs: timeMs, failures: [] })
    expect(result.names).toHaveLength(1)
    const name = result.names[0]
    const output = written.get(name)
    expect(output, `Missing POST /__capture for ${name}`).toBeDefined()
    const bytes = await readFile(output!)
    const image = await page.evaluate(async base64 => {
      const bitmap = new Image()
      bitmap.src = `data:image/png;base64,${base64}`
      await bitmap.decode()
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.naturalWidth
      canvas.height = bitmap.naturalHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })!
      context.drawImage(bitmap, 0, 0)
      return { width: canvas.width, height: canvas.height, pixels: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data) }
    }, bytes.toString('base64'))
    const evidencePath = join(evidenceDirectory, name)
    await mkdir(evidenceDirectory, { recursive: true })
    await copyFile(output!, evidencePath)
    const value: CaptureEvidence = {
      name, timeMs, path: name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
      width: image.width, height: image.height, positions: samplesAt(image, centres(image)), image,
    }
    captures.push(value)
    captureMs += performance.now() - start
    return value
  }
  return { install, capture, captures, captureMs: () => captureMs }
}

async function writeEvidence(name: string, testInfo: TestInfo, show: ShowRecordV2, harness: ReturnType<typeof captureHarness>, client: ShowMcpClient, timing: object, extra: object, browserErrors: string[]): Promise<void> {
  expect(browserErrors).toEqual([])
  expect(harness.captures.length).toBeGreaterThan(0)
  for (const capture of harness.captures) expect((await stat(join(evidenceDirectory, capture.path))).size).toBe(capture.bytes)
  const manifest = {
    issue: 1160, sourceBaseCommit: 'c4433f5a', test: name, workerIndex: testInfo.workerIndex, workers: 1,
    syntheticAccountConsumption: 'one account per test', show: { id: show.id, name: show.name },
    viewport: { width: 1280, height: 900 }, map: 'plane', referencePixelCount: 1024,
    previewSettings, captureSettings: { frames: 1, fps: 1000, fixedVirtualTime: true },
    browserErrors, timing, transcript: client.safeTranscript, ...extra,
    captures: harness.captures.map(({ image: _image, ...capture }) => capture),
  }
  await writeFile(join(evidenceDirectory, `${name}.json`), JSON.stringify(manifest, null, 2) + '\n')
}

test('real MCP replacement publishes known pixels, Undo/Redo, and reload (#1160)', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const started = performance.now()
  const browserErrors: string[] = []
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
  const original = await seed(page, 'agent-mcp-1160-adoption', 'MCP replacement browser proof')
  await openEditor(page, original)
  const harness = captureHarness(page, testInfo, 'adoption')
  await harness.install()
  const bindingStart = performance.now()
  const client = await boundClient(page, original)
  const bindingMs = performance.now() - bindingStart
  try {
    const solid = solidShow(original.id)
    await replace(client, solid, 'Show solid red')
    await assertStored(page, original, solid)
    await expect(page.getByRole('treeitem', { name: original.name, exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: 'Select Solid red', exact: true })).toBeVisible()
    const solid250 = await harness.capture('solid-250', 250)
    assertSamples(solid250, [red, red])
    const solidControl = await harness.capture('solid-control-250', 250)
    assertSamples(solidControl, [red, red])
    const unchanged = changedPixelsBetween(solid250.image, solidControl.image)
    const unchangedMeasurement = { comparable: true as const, changedPixels: unchanged.length,
      maximumChannelDelta: unchanged.reduce((max, pixel) => Math.max(max, ...pixel.left.map((value, index) => Math.abs(value - pixel.right[index]))), 0) }

    const zones = swappingZoneShow(original.id)
    await replace(client, zones, 'Show two Zones swapping colour at 500 ms')
    await assertStored(page, original, zones)
    await expect(page.getByRole('treeitem', { name: original.name, exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: 'Select Solid green', exact: true }).first()).toBeVisible()
    const zones250 = await harness.capture('zones-250', 250)
    assertSamples(zones250, [red, green])
    const zones750 = await harness.capture('zones-750', 750)
    assertSamples(zones750, [green, red])
    let faultExcerpt = ''
    try { assertSamples(solid250, [red, green]) } catch (error) { faultExcerpt = String(error).slice(0, 500) }
    expect(faultExcerpt).toContain('Expected')
    const restored = await harness.capture('zones-control-250', 250)
    assertSamples(restored, [red, green])

    await page.getByRole('button', { name: 'Undo Show edit' }).click()
    await assertStored(page, original, solid)
    const undone = await harness.capture('undo-solid-250', 250)
    assertSamples(undone, [red, red])
    await page.getByRole('button', { name: 'Redo Show edit' }).click()
    await assertStored(page, original, zones)
    assertSamples(await harness.capture('redo-zones-250', 250), [red, green])
    assertSamples(await harness.capture('redo-zones-750', 750), [green, red])

    await page.reload()
    await expect(page.getByRole('treeitem', { name: original.name, exact: true })).toHaveAttribute('aria-selected', 'true')
    await page.waitForFunction(id => (window as CaptureWindow).__pxlblzShow?.showId === id, original.id)
    await page.evaluate(settings => (window as CaptureWindow).__pxlblzShow!.setPreview(settings), previewSettings)
    await assertStored(page, original, zones)
    assertSamples(await harness.capture('reload-zones-250', 250), [red, green])
    assertSamples(await harness.capture('reload-zones-750', 750), [green, red])
    await writeEvidence('adoption', testInfo, original, harness, client, { setupMs: bindingStart - started, bindingMs, captureMs: harness.captureMs(), totalMs: performance.now() - started }, {
      unchangedState: { first: solid250.sha256, second: solidControl.sha256, sampleExact: true, allImage: unchangedMeasurement, allImageExact: measuredExact(unchangedMeasurement) },
      faultControl: { injectedImage: solid250.path, target: zones250.path, rejected: true, excerpt: faultExcerpt, restoredImage: restored.path },
      assertions: ['saved complete authored record', 'retained name and selected rail row', 'Undo/Redo durable records', 'reload durable record', 'literal grid-centre RGBA'],
    }, browserErrors)
  } finally { await client.close() }
})

test('dirty duration refuses a stale MCP replacement after manual commit (#1160)', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const started = performance.now()
  const browserErrors: string[] = []
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
  const original = await seed(page, 'agent-mcp-1160-dirty', 'MCP dirty field browser proof')
  await openEditor(page, original)
  const harness = captureHarness(page, testInfo, 'dirty')
  await harness.install()
  const bindingStart = performance.now()
  const client = await boundClient(page, original)
  const bindingMs = performance.now() - bindingStart
  try {
    const solid = solidShow(original.id)
    await replace(client, solid, 'Seed solid red')
    const before = await assertStored(page, original, solid)
    const candidate = greenShow(original.id)
    const read = await client.tool('read_show', { binding_id: client.bindingId })
    expect(read).toMatchObject({ code: 'read', show: { id: original.id } })
    const begun = await client.tool('begin_edit', { binding_id: client.bindingId, intent: 'Change solid red to green', idempotency_key: randomUUID() })
    expect(begun.code).toBe('begun')
    const identity = { binding_id: client.bindingId, operation_id: begun.operation_id as string }
    expect((await client.tool('replace_show', { ...identity, idempotency_key: randomUUID(), show: candidate })).code).toBe('changed')
    await page.getByRole('button', { name: 'Select Solid red', exact: true }).first().click()
    const duration = page.getByRole('textbox', { name: 'Duration seconds exact time' })
    await duration.fill('0.75')
    await expect(duration).toBeFocused()
    expect((await client.tool('commit_edit', { ...identity, idempotency_key: randomUUID() })).code).toBe('outcome')
    await expect.poll(async () => (await client.tool('get_outcome', identity)).receipt).toMatchObject({ status: 'waiting' })
    await expect(duration).toBeFocused()
    expect(await findStoredShowV2(page, original.id)).toEqual(before)
    await duration.press('Enter')
    await expect.poll(async () => (await client.tool('get_outcome', identity)).receipt).toMatchObject({ status: 'refused', reason: 'revision-conflict' })
    await expect(duration).toHaveValue('0.75')
    const manual = structuredClone(solid)
    manual.composition.clips[0].durationMs = 750
    const stored = await assertStored(page, original, manual)
    expect(stored.composition.showEndMs).toBe(1000)
    expect(stored.composition.patternInstances.map(instance => instance.pattern.id)).not.toContain('mcp-green')
    await expect(page.getByRole('treeitem', { name: original.name, exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: 'Select Solid red', exact: true })).toBeVisible()
    assertSamples(await harness.capture('manual-250', 250), [red, red])
    await writeEvidence('dirty-field', testInfo, original, harness, client, { setupMs: bindingStart - started, bindingMs, captureMs: harness.captureMs(), totalMs: performance.now() - started }, {
      waiting: { focusedField: 'Duration seconds exact time', draft: '0.75', durableUnchanged: true },
      refusal: { status: 'refused', reason: 'revision-conflict', manualClipDurationMs: 750, showEndMs: 1000, candidatePatternAbsent: 'mcp-green' },
    }, browserErrors)
  } finally { await client.close() }
})
