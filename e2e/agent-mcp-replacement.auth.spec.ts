import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page, TestInfo } from '@playwright/test'
import type { ShowRecordV2 } from '../src/engine/showCompositionV2'
import { changedPixelsBetween, measuredExact, samplesAt, type Rgba, type RgbaImage } from '../src/test/showCapturePixelEvidence'
import { showMcpReplacementCases } from '../src/test/showMcpReplacementFixtures'
import { expect, test } from './fixtures/authenticated'
import { squareWorkspaceShow } from './fixtures/showWorkspace'
import { findStoredShowV2, seedShowV2 } from './support/showBackingRecords'
import { connectShowMcp, type ShowMcpClient } from './support/agentMcpClient'

const relevantTestFiles = [
  'e2e/agent-mcp-replacement.auth.spec.ts',
  'e2e/fixtures/authenticated.ts',
  'e2e/support/agentMcpClient.ts',
  'e2e/support/showBackingRecords.ts',
  'src/test/showCapturePixelEvidence.ts',
  'src/test/showMcpReplacementFixtures.ts',
]
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

function overlaidShow(id: string): ShowRecordV2 {
  const show = solidShow(id)
  const redClip = show.composition.clips[0]
  redClip.id = 'base-red-clip'
  redClip.appearance.keys[0].id = 'base-red-appearance'
  show.composition.patternInstances.push({
    ...structuredClone(greenShow(id).composition.patternInstances[0]), id: 'overlay-green-instance',
  })
  show.composition.layers.push({ id: 'overlay-green-layer', zoneId: 'left', name: 'Green overlay', rank: 1 })
  show.composition.clips.push({
    ...structuredClone(redClip), id: 'overlay-green-clip',
    instanceId: 'overlay-green-instance', layerId: 'overlay-green-layer',
    appearance: { keys: [{ ...structuredClone(redClip.appearance.keys[0]), id: 'overlay-green-appearance' }] },
  })
  return show
}

async function seedPatterns(page: Page): Promise<void> {
  for (const pattern of zoneCase.patterns) {
    const response = await page.context().request.post('/api/patterns', { data: pattern })
    expect(response.ok(), `POST /api/patterns/${pattern.id}: HTTP ${response.status()}`).toBe(true)
  }
}

async function seedSolid(page: Page, id: string, name: string): Promise<ShowRecordV2> {
  return seedShowV2(page, { ...squareWorkspaceShow(1), id, name }, name, {
    edit: converted => {
      Object.assign(converted, solidShow(id), { name, updatedAt: converted.updatedAt })
    },
  })
}

async function seed(page: Page, id: string, name: string): Promise<ShowRecordV2> {
  const show = await seedShowV2(page, { ...squareWorkspaceShow(1), id, name }, name)
  await seedPatterns(page)
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
  const testIdHash = createHash('sha256').update(testInfo.testId).digest('hex').slice(0, 16)
  const runDirectory = join(process.cwd(), 'playwright-report', 'agent-mcp',
    `${testIdHash}-worker-${testInfo.workerIndex}-retry-${testInfo.retry}-repeat-${testInfo.repeatEachIndex}`)
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
    const evidencePath = join(runDirectory, name)
    await mkdir(runDirectory, { recursive: true })
    await copyFile(output!, evidencePath)
    const value: CaptureEvidence = {
      name, timeMs, path: name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
      width: image.width, height: image.height, positions: samplesAt(image, centres(image)), image,
    }
    captures.push(value)
    captureMs += performance.now() - start
    return value
  }
  return { install, capture, captures, captureMs: () => captureMs, runDirectory }
}

async function writeEvidence(name: string, testInfo: TestInfo, show: ShowRecordV2, harness: ReturnType<typeof captureHarness>, client: ShowMcpClient, timing: object, extra: object, browserErrors: string[], issue = 1160): Promise<void> {
  expect(browserErrors).toEqual([])
  expect(harness.captures.length).toBeGreaterThan(0)
  for (const capture of harness.captures) {
    const bytes = await readFile(join(harness.runDirectory, capture.path))
    expect(bytes.length, `${capture.path} byte count`).toBe(capture.bytes)
    expect(createHash('sha256').update(bytes).digest('hex'), `${capture.path} SHA-256`).toBe(capture.sha256)
  }
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const testFileStatus = execFileSync('git', ['status', '--short', '--', ...relevantTestFiles],
    { encoding: 'utf8', maxBuffer: 8192 }).trim().split('\n').filter(Boolean)
  const manifest = {
    issue, sourceCommit, test: name,
    workers: testInfo.config.workers, workerIndex: testInfo.workerIndex, parallelIndex: testInfo.parallelIndex,
    retry: testInfo.retry, repeatEachIndex: testInfo.repeatEachIndex,
    testFilesUncommitted: testFileStatus.length > 0, testFileStatus,
    syntheticAccountConsumption: 'one account per test', show: { id: show.id, name: show.name },
    viewport: { width: 1280, height: 900 }, map: 'plane', referencePixelCount: 1024,
    previewSettings, captureSettings: { frames: 1, fps: 1000, fixedVirtualTime: true },
    browserErrors, timing, transcript: client.safeTranscript, ...extra,
    captures: harness.captures.map(({ image: _image, ...capture }) => capture),
  }
  await writeFile(join(harness.runDirectory, `${name}.json`), JSON.stringify(manifest, null, 2) + '\n')
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

test('MCP replacement reconciles Clip selection, UI Delete, and keyboard history (#1162)', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const started = performance.now()
  const browserErrors: string[] = []
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
  const original = await seed(page, 'agent-mcp-1162-selection', 'MCP selection and history proof')
  await openEditor(page, original)
  const harness = captureHarness(page, testInfo, 'selection')
  await harness.install()
  const bindingStart = performance.now()
  const client = await boundClient(page, original)
  const bindingMs = performance.now() - bindingStart
  const selections: Array<Record<string, unknown>> = []
  const rail = page.getByRole('treeitem', { name: original.name, exact: true })
  const duration = page.getByRole('textbox', { name: 'Duration seconds exact time' })
  try {
    const solid = solidShow(original.id)
    await replace(client, solid, 'Show solid red before Clip selection')
    await assertStored(page, original, solid)
    const redClip = page.getByRole('button', { name: 'Select Solid red', exact: true })
    await redClip.click()
    await expect(duration).toBeVisible()
    await expect(duration).toHaveValue('1')
    selections.push({ step: 'selected original red Clip', railSelected: await rail.getAttribute('aria-selected'),
      durationVisible: await duration.isVisible(), durationValue: await duration.inputValue() })

    const overlaid = overlaidShow(original.id)
    const deleted = structuredClone(overlaid)
    deleted.composition.clips = deleted.composition.clips.filter(clip => clip.id !== 'overlay-green-clip')
    deleted.composition.patternInstances = deleted.composition.patternInstances.filter(instance => instance.id !== 'overlay-green-instance')
    await replace(client, overlaid, 'Replace selected Clip with red base and green overlay')
    await assertStored(page, original, overlaid)
    await expect(duration).not.toBeVisible()
    await expect(rail).toHaveAttribute('aria-selected', 'true')
    await expect(redClip).toBeVisible()
    const greenClip = page.getByRole('button', { name: 'Select Solid green', exact: true })
    await expect(greenClip).toBeVisible()
    selections.push({ step: 'replacement reconciled missing selected Clip', railSelected: await rail.getAttribute('aria-selected'),
      oldDurationVisible: await duration.isVisible(), redVisible: await redClip.isVisible(), greenVisible: await greenClip.isVisible() })
    const overlaid250 = await harness.capture('overlaid-250', 250)
    assertSamples(overlaid250, [green, green])
    let faultExcerpt = ''
    try { assertSamples(overlaid250, [red, red]) } catch (error) { faultExcerpt = String(error).slice(0, 500) }
    expect(faultExcerpt).toContain('Expected')
    assertSamples(overlaid250, [green, green])

    await greenClip.click()
    await expect(duration).toBeVisible()
    await greenClip.click()
    await expect(duration).not.toBeVisible()
    await expect(greenClip).toBeFocused()
    await page.keyboard.press('Delete')
    await assertStored(page, original, deleted)
    await expect(greenClip).toHaveCount(0)
    await expect(redClip).toBeVisible()
    selections.push({ step: 'deleted green Clip from timeline button', keyboardTarget: 'Select Solid green',
      greenCount: await greenClip.count(), redVisible: await redClip.isVisible() })
    assertSamples(await harness.capture('deleted-red-250', 250), [red, red])

    await redClip.click()
    await redClip.click()
    await expect(redClip).toBeFocused()
    await redClip.press('ControlOrMeta+z')
    await assertStored(page, original, overlaid)
    await expect(greenClip).toBeVisible()
    selections.push({ step: 'keyboard Undo restored replacement', keyboardTarget: 'Select Solid red',
      greenVisible: await greenClip.isVisible() })
    assertSamples(await harness.capture('undo-green-250', 250), [green, green])

    await redClip.press('ControlOrMeta+Shift+z')
    await assertStored(page, original, deleted)
    await expect(greenClip).toHaveCount(0)
    await expect(redClip).toBeVisible()
    selections.push({ step: 'keyboard Redo restored deletion', keyboardTarget: 'Select Solid red',
      greenCount: await greenClip.count(), redVisible: await redClip.isVisible() })
    assertSamples(await harness.capture('redo-red-250', 250), [red, red])
    await writeEvidence('selection-history', testInfo, original, harness, client,
      { setupMs: bindingStart - started, bindingMs, captureMs: harness.captureMs(), totalMs: performance.now() - started }, {
        selections, assertions: ['complete saved record after each replacement, Delete, Undo, and Redo',
          'old selected Clip detail removed while Show rail selection persists', 'literal green/red Stage pixels at 250 ms'],
        faultControl: { image: overlaid250.path, rejectedExpected: [red, red], rejected: true,
          excerpt: faultExcerpt, restoredExpected: [green, green] },
      }, browserErrors, 1162)
  } finally { await client.close() }
})

test('navigation retires an uncommitted MCP replacement without saving either Show (#1162)', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const started = performance.now()
  const browserErrors: string[] = []
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
  const showA = await seedSolid(page, 'agent-mcp-1162-navigation-a', 'MCP private Show A')
  const showB = await seedSolid(page, 'agent-mcp-1162-navigation-b', 'MCP private Show B')
  await seedPatterns(page)
  const originalA = await findStoredShowV2(page, showA.id)
  const originalB = await findStoredShowV2(page, showB.id)
  expect(originalA).toEqual(showA)
  expect(originalB).toEqual(showB)
  const assertUnchanged = async () => {
    expect(await findStoredShowV2(page, showA.id)).toEqual(originalA)
    expect(await findStoredShowV2(page, showB.id)).toEqual(originalB)
  }
  await openEditor(page, showA)
  const harness = captureHarness(page, testInfo, 'navigation')
  await harness.install()
  const bindingStart = performance.now()
  const client = await boundClient(page, showA)
  const bindingMs = performance.now() - bindingStart
  const selections: Array<Record<string, unknown>> = []
  const railA = page.getByRole('treeitem', { name: /^MCP private Show A(?: More actions for MCP private Show A)?$/ })
  const railB = page.getByRole('treeitem', { name: /^MCP private Show B(?: More actions for MCP private Show B)?$/ })
  const identity = { binding_id: client.bindingId, operation_id: '' }
  try {
    await expect(railA).toHaveAttribute('aria-selected', 'true')
    await expect(railB).toBeVisible()
    expect((await client.tool('read_show', { binding_id: client.bindingId })).code).toBe('read')
    const begun = await client.tool('begin_edit', {
      binding_id: client.bindingId, intent: 'Private green candidate that must retire on navigation', idempotency_key: randomUUID(),
    })
    expect(begun.code).toBe('begun')
    expect(typeof begun.operation_id).toBe('string')
    identity.operation_id = begun.operation_id as string
    expect((await client.tool('replace_show', { ...identity, idempotency_key: randomUUID(), show: greenShow(showA.id) })).code).toBe('changed')
    await assertUnchanged()
    selections.push({ step: 'private green candidate on A', selectedA: await railA.getAttribute('aria-selected'),
      selectedB: await railB.getAttribute('aria-selected'), showId: await page.evaluate(() => (window as CaptureWindow).__pxlblzShow?.showId) })
    assertSamples(await harness.capture('a-before-navigation-250', 250), [red, red])

    await railB.click()
    await expect(railB).toHaveAttribute('aria-selected', 'true')
    await page.waitForFunction(id => (window as CaptureWindow).__pxlblzShow?.showId === id, showB.id)
    await expect(page.getByTestId('show-stage-canvas-frame')).toHaveAttribute('aria-busy', 'false')
    await page.evaluate(settings => (window as CaptureWindow).__pxlblzShow!.setPreview(settings), previewSettings)
    await expect.poll(async () => (await client.tool('read_show', { binding_id: client.bindingId })).code).toBe('no_live_editor')
    const refusedAtB = await client.tool('commit_edit', { ...identity, idempotency_key: randomUUID() })
    expect(refusedAtB.code).toBe('no_live_editor')
    await assertUnchanged()
    selections.push({ step: 'B selected after old binding retired', selectedA: await railA.getAttribute('aria-selected'),
      selectedB: await railB.getAttribute('aria-selected'), showId: await page.evaluate(() => (window as CaptureWindow).__pxlblzShow?.showId),
      commitCode: refusedAtB.code })
    assertSamples(await harness.capture('b-250', 250), [red, red])

    await railA.click()
    await expect(railA).toHaveAttribute('aria-selected', 'true')
    await page.waitForFunction(id => (window as CaptureWindow).__pxlblzShow?.showId === id, showA.id)
    await expect(page.getByTestId('show-stage-canvas-frame')).toHaveAttribute('aria-busy', 'false')
    await page.evaluate(settings => (window as CaptureWindow).__pxlblzShow!.setPreview(settings), previewSettings)
    const refusedAtReturn = await client.tool('commit_edit', { ...identity, idempotency_key: randomUUID() })
    expect(refusedAtReturn.code).toBe('no_live_editor')
    await assertUnchanged()
    selections.push({ step: 'A selected again without binding resurrection', selectedA: await railA.getAttribute('aria-selected'),
      selectedB: await railB.getAttribute('aria-selected'), showId: await page.evaluate(() => (window as CaptureWindow).__pxlblzShow?.showId),
      commitCode: refusedAtReturn.code })
    assertSamples(await harness.capture('a-return-250', 250), [red, red])
    await writeEvidence('navigation-retirement', testInfo, showA, harness, client,
      { setupMs: bindingStart - started, bindingMs, captureMs: harness.captureMs(), totalMs: performance.now() - started }, {
        shows: [{ id: showA.id, name: showA.name }, { id: showB.id, name: showB.name }],
        selections, refusals: { atB: refusedAtB.code, atReturn: refusedAtReturn.code },
        assertions: ['A and B complete durable records remain their pre-navigation snapshots at every step',
          'old binding returns no_live_editor after B selection and after returning to A',
          'both editors display literal solid-red Stage pixels at 250 ms'],
      }, browserErrors, 1162)
  } finally { await client.close() }
})

test('dirty duration Escape releases a waiting MCP replacement as one history step (#1165)', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const started = performance.now()
  const browserErrors: string[] = []
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
  const original = await seedSolid(page, 'agent-mcp-1165-escape', 'MCP Escape wait proof')
  await seedPatterns(page)
  await openEditor(page, original)
  const harness = captureHarness(page, testInfo, 'escape')
  await harness.install()
  const bindingStart = performance.now()
  const client = await boundClient(page, original)
  const bindingMs = performance.now() - bindingStart
  try {
    const before = await assertStored(page, original, original)
    assertSamples(await harness.capture('red-before-250', 250), [red, red])
    const candidate = greenShow(original.id)
    expect((await client.tool('read_show', { binding_id: client.bindingId })).code).toBe('read')
    const begun = await client.tool('begin_edit', { binding_id: client.bindingId, intent: 'Replace red after duration Escape', idempotency_key: randomUUID() })
    expect(begun.code).toBe('begun')
    expect(typeof begun.operation_id).toBe('string')
    const identity = { binding_id: client.bindingId, operation_id: begun.operation_id as string }
    expect((await client.tool('replace_show', { ...identity, idempotency_key: randomUUID(), show: candidate })).code).toBe('changed')
    const redClip = page.getByRole('button', { name: 'Select Solid red', exact: true })
    await redClip.click()
    const duration = page.getByRole('textbox', { name: 'Duration seconds exact time' })
    await duration.fill('0.75')
    await expect(duration).toBeFocused()
    expect((await client.tool('commit_edit', { ...identity, idempotency_key: randomUUID() })).code).toBe('outcome')
    await expect.poll(async () => (await client.tool('get_outcome', identity)).receipt).toMatchObject({ status: 'waiting' })
    await expect(duration).toBeFocused()
    expect(await findStoredShowV2(page, original.id)).toEqual(before)
    await duration.press('Escape')
    await expect.poll(async () => (await client.tool('get_outcome', identity)).receipt).toMatchObject({ status: 'applied', settlement: 'saved' })
    await assertStored(page, original, candidate)
    await expect(duration).not.toBeVisible()
    await expect(redClip).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Select Solid green', exact: true })).toBeVisible()
    assertSamples(await harness.capture('green-after-escape-250', 250), [green, green])
    await page.getByRole('button', { name: 'Undo Show edit' }).click()
    await assertStored(page, original, original)
    await expect(redClip).toBeVisible()
    await expect(page.getByRole('button', { name: 'Select Solid green', exact: true })).toHaveCount(0)
    assertSamples(await harness.capture('red-after-undo-250', 250), [red, red])
    await writeEvidence('escape-release', testInfo, original, harness, client,
      { setupMs: bindingStart - started, bindingMs, captureMs: harness.captureMs(), totalMs: performance.now() - started }, {
        waiting: { focusedField: 'Duration seconds exact time', draft: '0.75', durableUnchanged: true },
        outcome: { status: 'applied', settlement: 'saved', release: 'Escape', undoRestoredOriginal: true },
      }, browserErrors, 1165)
  } finally { await client.close() }
})

test('cancel_edit during dirty-input wait preserves red and permits a fresh replacement (#1165)', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const started = performance.now()
  const browserErrors: string[] = []
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
  const original = await seedSolid(page, 'agent-mcp-1165-cancel', 'MCP cancel wait proof')
  await seedPatterns(page)
  await openEditor(page, original)
  const harness = captureHarness(page, testInfo, 'cancel')
  await harness.install()
  const bindingStart = performance.now()
  const client = await boundClient(page, original)
  const bindingMs = performance.now() - bindingStart
  try {
    const before = await assertStored(page, original, original)
    const candidate = greenShow(original.id)
    expect((await client.tool('read_show', { binding_id: client.bindingId })).code).toBe('read')
    const begun = await client.tool('begin_edit', { binding_id: client.bindingId, intent: 'Cancel green candidate during duration wait', idempotency_key: randomUUID() })
    expect(begun.code).toBe('begun')
    expect(typeof begun.operation_id).toBe('string')
    const identity = { binding_id: client.bindingId, operation_id: begun.operation_id as string }
    expect((await client.tool('replace_show', { ...identity, idempotency_key: randomUUID(), show: candidate })).code).toBe('changed')
    await page.getByRole('button', { name: 'Select Solid red', exact: true }).click()
    const duration = page.getByRole('textbox', { name: 'Duration seconds exact time' })
    await duration.fill('0.75')
    await expect(duration).toBeFocused()
    expect((await client.tool('commit_edit', { ...identity, idempotency_key: randomUUID() })).code).toBe('outcome')
    await expect.poll(async () => (await client.tool('get_outcome', identity)).receipt).toMatchObject({ status: 'waiting' })
    expect(await findStoredShowV2(page, original.id)).toEqual(before)
    const cancelled = await client.tool('cancel_edit', { ...identity, idempotency_key: randomUUID() })
    expect(cancelled).toMatchObject({ code: 'outcome', receipt: { status: 'cancelled' } })
    await duration.press('Escape')
    await expect.poll(async () => (await client.tool('get_outcome', identity)).receipt).toMatchObject({ status: 'cancelled' })
    await assertStored(page, original, original)
    await expect(page.getByRole('button', { name: 'Select Solid red', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Select Solid green', exact: true })).toHaveCount(0)
    assertSamples(await harness.capture('red-after-cancel-250', 250), [red, red])
    const freshIdentity = await replace(client, candidate, 'Fresh green replacement after cancellation')
    await assertStored(page, original, candidate)
    await expect(page.getByRole('button', { name: 'Select Solid green', exact: true })).toBeVisible()
    assertSamples(await harness.capture('green-after-fresh-250', 250), [green, green])
    expect((await client.tool('get_outcome', identity)).receipt).toMatchObject({ status: 'cancelled' })
    await writeEvidence('cancel-wait', testInfo, original, harness, client,
      { setupMs: bindingStart - started, bindingMs, captureMs: harness.captureMs(), totalMs: performance.now() - started }, {
        cancelledOperationId: identity.operation_id, freshOperationId: freshIdentity.operation_id,
        assertions: ['cancelled receipt remains terminal after draft Escape and a fresh saved replacement', 'complete red then green records and literal Stage pixels'],
      }, browserErrors, 1165)
  } finally { await client.close() }
})

test('textbox Undo leaves MCP history to the timeline (#1165)', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const started = performance.now()
  const browserErrors: string[] = []
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
  const original = await seedSolid(page, 'agent-mcp-1165-textbox-undo', 'MCP textbox history proof')
  await seedPatterns(page)
  await openEditor(page, original)
  const harness = captureHarness(page, testInfo, 'textbox-undo')
  await harness.install()
  const bindingStart = performance.now()
  const client = await boundClient(page, original)
  const bindingMs = performance.now() - bindingStart
  try {
    const candidate = greenShow(original.id)
    await replace(client, candidate, 'Replace red with green before textbox Undo')
    const before = await assertStored(page, original, candidate)
    const greenClip = page.getByRole('button', { name: 'Select Solid green', exact: true })
    await greenClip.click()
    const duration = page.getByRole('textbox', { name: 'Duration seconds exact time' })
    await duration.fill('0.75')
    await expect(duration).toBeFocused()
    await duration.press('ControlOrMeta+z')
    expect(await findStoredShowV2(page, original.id)).toEqual(before)
    await duration.press('Escape')
    await assertStored(page, original, candidate)
    assertSamples(await harness.capture('green-after-textbox-undo-250', 250), [green, green])
    if (await duration.isVisible()) await greenClip.click()
    await expect(duration).not.toBeVisible()
    await expect(greenClip).toBeFocused()
    await greenClip.press('ControlOrMeta+z')
    await assertStored(page, original, original)
    await expect(greenClip).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Select Solid red', exact: true })).toBeVisible()
    assertSamples(await harness.capture('red-after-timeline-undo-250', 250), [red, red])
    await writeEvidence('textbox-history', testInfo, original, harness, client,
      { setupMs: bindingStart - started, bindingMs, captureMs: harness.captureMs(), totalMs: performance.now() - started }, {
        assertions: ['textbox Undo did not consume document history', 'Escape discarded the duration draft', 'timeline Undo restored the complete original red record'],
      }, browserErrors, 1165)
  } finally { await client.close() }
})

test('timeline Undo supersedes a private MCP candidate without truncating Redo (#1165)', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const started = performance.now()
  const browserErrors: string[] = []
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
  const original = await seedSolid(page, 'agent-mcp-1165-undo-private', 'MCP stale candidate proof')
  await seedPatterns(page)
  await openEditor(page, original)
  const harness = captureHarness(page, testInfo, 'undo-private')
  await harness.install()
  const bindingStart = performance.now()
  const client = await boundClient(page, original)
  const bindingMs = performance.now() - bindingStart
  try {
    const greenShowRecord = greenShow(original.id)
    await replace(client, greenShowRecord, 'Replace red with green before private edit')
    await assertStored(page, original, greenShowRecord)
    const halfOpacity = structuredClone(greenShowRecord)
    halfOpacity.composition.clips[0].appearance.keys[0].value.opacity = 0.5
    expect((await client.tool('read_show', { binding_id: client.bindingId })).code).toBe('read')
    const begun = await client.tool('begin_edit', { binding_id: client.bindingId, intent: 'Private half-opacity green candidate', idempotency_key: randomUUID() })
    expect(begun.code).toBe('begun')
    expect(typeof begun.operation_id).toBe('string')
    const identity = { binding_id: client.bindingId, operation_id: begun.operation_id as string }
    expect((await client.tool('replace_show', { ...identity, idempotency_key: randomUUID(), show: halfOpacity })).code).toBe('changed')
    const greenClip = page.getByRole('button', { name: 'Select Solid green', exact: true })
    await greenClip.click()
    const duration = page.getByRole('textbox', { name: 'Duration seconds exact time' })
    await expect(duration).toBeVisible()
    await greenClip.click()
    await expect(duration).not.toBeVisible()
    await expect(greenClip).toBeFocused()
    await greenClip.press('ControlOrMeta+z')
    await assertStored(page, original, original)
    const rejected = await client.tool('commit_edit', { ...identity, idempotency_key: randomUUID() })
    expect(rejected.code).toBe('outcome')
    await expect.poll(async () => (await client.tool('get_outcome', identity)).receipt).toMatchObject({ status: 'refused', reason: 'revision-conflict' })
    await assertStored(page, original, original)
    await expect(greenClip).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Select Solid red', exact: true })).toBeVisible()
    assertSamples(await harness.capture('red-after-refusal-250', 250), [red, red])
    await page.getByRole('button', { name: 'Redo Show edit' }).click()
    await assertStored(page, original, greenShowRecord)
    await expect(greenClip).toBeVisible()
    assertSamples(await harness.capture('green-after-redo-250', 250), [green, green])
    await writeEvidence('undo-private', testInfo, original, harness, client,
      { setupMs: bindingStart - started, bindingMs, captureMs: harness.captureMs(), totalMs: performance.now() - started }, {
        refusal: { status: 'refused', reason: 'revision-conflict', rejectedOpacity: 0.5 },
        assertions: ['complete red record and pixels survive rejected private commit', 'Redo restores the saved full-green record'],
      }, browserErrors, 1165)
  } finally { await client.close() }
})

test('reload retires a private MCP candidate and its old binding (#1165)', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const started = performance.now()
  const browserErrors: string[] = []
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
  const original = await seedSolid(page, 'agent-mcp-1165-reload', 'MCP reload retirement proof')
  await seedPatterns(page)
  await openEditor(page, original)
  const harness = captureHarness(page, testInfo, 'reload-private')
  await harness.install()
  const bindingStart = performance.now()
  const client = await boundClient(page, original)
  const bindingMs = performance.now() - bindingStart
  try {
    const before = await assertStored(page, original, original)
    const candidate = greenShow(original.id)
    expect((await client.tool('read_show', { binding_id: client.bindingId })).code).toBe('read')
    const begun = await client.tool('begin_edit', { binding_id: client.bindingId, intent: 'Private green candidate retired by reload', idempotency_key: randomUUID() })
    expect(begun.code).toBe('begun')
    expect(typeof begun.operation_id).toBe('string')
    const identity = { binding_id: client.bindingId, operation_id: begun.operation_id as string }
    expect((await client.tool('replace_show', { ...identity, idempotency_key: randomUUID(), show: candidate })).code).toBe('changed')
    expect(await findStoredShowV2(page, original.id)).toEqual(before)
    await page.reload()
    await expect(page.getByRole('treeitem', { name: original.name, exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('show-stage-canvas-frame')).toHaveAttribute('aria-busy', 'false')
    await page.waitForFunction(id => (window as CaptureWindow).__pxlblzShow?.showId === id, original.id)
    await page.evaluate(settings => (window as CaptureWindow).__pxlblzShow!.setPreview(settings), previewSettings)
    await expect.poll(async () => (await client.tool('read_show', { binding_id: client.bindingId })).code).toBe('no_live_editor')
    expect((await client.tool('commit_edit', { ...identity, idempotency_key: randomUUID() })).code).toBe('no_live_editor')
    await assertStored(page, original, original)
    await expect(page.getByRole('button', { name: 'Select Solid red', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Select Solid green', exact: true })).toHaveCount(0)
    assertSamples(await harness.capture('red-after-reload-250', 250), [red, red])
    await writeEvidence('reload-retirement', testInfo, original, harness, client,
      { setupMs: bindingStart - started, bindingMs, captureMs: harness.captureMs(), totalMs: performance.now() - started }, {
        refusals: { read: 'no_live_editor', commit: 'no_live_editor' },
        assertions: ['complete original red record survived reload', 'private green Clip never appeared', 'literal red Stage pixels at 250 ms'],
      }, browserErrors, 1165)
  } finally { await client.close() }
})
