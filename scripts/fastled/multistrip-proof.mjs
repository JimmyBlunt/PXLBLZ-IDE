// Compare the IDE worker with an independently read upstream WASM visual buffer.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { chromium } from 'playwright';

if (!process.argv[2]) throw new Error('Usage: node scripts/fastled/multistrip-proof.mjs <artifact.json>');
const artifact = JSON.parse(await readFile(process.argv[2], 'utf8'));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5184/PXLBLZ-IDE/fastled', { waitUntil: 'domcontentloaded', timeout: 180000 });
  const result = await page.evaluate(async artifact => {
    const factory = (await import(artifact.moduleUrl)).default;
    const bootstrap = URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(artifact.runtimeUrl)});`], { type: 'application/javascript' }));
    const reference = await factory({ noInitialRun: true, mainScriptUrlOrBlob: bootstrap,
      locateFile: file => new URL(file, artifact.moduleUrl).href, print: () => {}, printErr: () => {} });
    await reference._extern_setup();
    const sizePointer = reference._malloc(4);
    const metadataPointer = reference._getFrameData(sizePointer);
    const readSize = () => new DataView(reference.HEAPU8.buffer).getInt32(sizePointer, true);
    const metadata = JSON.parse(new TextDecoder().decode(reference.HEAPU8.slice(metadataPointer, metadataPointer + readSize())).replace(/\0$/, ''));
    const expected = [];
    const strips = [];
    for (const strip of metadata.sort((a, b) => a.strip_id - b.strip_id)) {
      const pointer = reference._getStripPixelData(strip.strip_id, sizePointer);
      const bytes = Array.from(reference.HEAPU8.slice(pointer, pointer + readSize()));
      strips.push({ id: strip.strip_id, bytes });
      expected.push(...bytes);
    }
    reference._freeFrameData(metadataPointer);
    reference._free(sizePointer);
    const { createFastLedRuntime } = await import('/PXLBLZ-IDE/src/engine/fastled/index.ts');
    const frames = [], errors = [];
    const controller = new AbortController();
    const runtime = await createFastLedRuntime({ artifact, signal: controller.signal,
      onFrame: frame => frames.push(Array.from(frame)), onError: message => errors.push(message) });
    const waitFrame = async previous => {
      const deadline = performance.now() + 10000;
      while (frames.length <= previous) {
        if (errors.length || performance.now() > deadline) throw new Error(errors.join('\n') || 'No multi-strip frame');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    };
    try {
      runtime.start();
      await waitFrame(0);
      await new Promise(resolve => setTimeout(resolve, 100));
      const beforeReset = frames.length;
      runtime.reset();
      await waitFrame(beforeReset);
      controller.abort();
      const afterAbort = frames.length;
      await new Promise(resolve => setTimeout(resolve, 100));
      if (frames.length !== afterAbort) throw new Error('Aborted blocked sketch delivered a frame');
      return { expected, strips, frames, errors };
    } finally { runtime.dispose(); }
  }, artifact);
  assert.deepEqual(result.errors, []);
  assert.equal(result.strips.length, 2);
  assert.equal(result.expected.length, 9);
  for (const frame of result.frames) assert.deepEqual(frame, result.expected);
  const evidence = { capturedAt: new Date().toISOString(), artifactId: artifact.id,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), ...result,
    contract: 'IDE RGB equals the original WASM visual buffer at brightness 128 and TypicalLEDStrip correction',
    passed: ['multiple strips and stable order', 'upstream visual brightness/correction behavior', 'responsive UI during infinite C++ loop', 'reset blocked loop', 'abort blocked loop'] };
  await writeFile(new URL('../../docs/fastled/evidence/runtime-multistrip.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); }
