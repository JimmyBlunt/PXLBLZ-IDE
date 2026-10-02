import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';

const ROOT = resolve(new URL('../../', import.meta.url).pathname);
const endpoint = new URL(process.env.FASTLED_COMPILER_URL || 'http://127.0.0.1:9982');
const ideUrl = process.env.FASTLED_IDE_URL || 'http://127.0.0.1:5184/PXLBLZ-IDE/fastled';
const output = resolve(ROOT, process.argv[2] || 'docs/fastled/evidence/matrix-performance.json');
const sha256 = value => createHash('sha256').update(value).digest('hex');

const thresholds = Object.freeze({
  coldCompileMsMax: 600_000,
  warmCompileMsMax: 5_000,
  wasmBytesMax: 10 * 1024 * 1024,
  initializationMsMax: 30_000,
  steadyStateFpsMin: 5,
  mainThreadMaxGapMs: 250,
});

const cases = [
  {
    name: 'Animartrix',
    source: 'test/fastled/matrix/upstream/Animartrix.ino',
    expectedPixels: 4096,
    expectedLayoutSamples: {
      0: [0, 0],
      63: [1, 0],
      4032: [0, 1],
      4095: [1, 1],
    },
  },
  {
    name: 'WasmScreenCoords',
    source: 'test/fastled/matrix/upstream/WasmScreenCoords.ino',
    expectedPixels: 512,
    expectedFirstPixels: {
      0: [0, 0, 255],
      255: [0, 0, 255],
      256: [255, 0, 0],
      511: [255, 0, 0],
    },
    expectedLayoutSamples: {
      0: [0.5, 0.5],
      255: [1, 1],
      256: [0.5, 0.5],
      511: [0, 0],
    },
  },
];

async function compile(name, source) {
  const started = performance.now();
  const response = await fetch(new URL('/compile', endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, source }),
    signal: AbortSignal.timeout(12 * 60_000),
  });
  const body = await response.json();
  const elapsedMs = performance.now() - started;
  assert.equal(response.status, 200, body.diagnostics || body.error);
  return { artifact: body, elapsedMs };
}

async function downloadBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  assert.equal(response.status, 200);
  return Buffer.from(await response.arrayBuffer());
}

const evidence = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  fastledVersion: '3.10.4',
  fastledCommit: 'adedfc40e73fb80f8e930318781036d8fe1dbd9f',
  compilerEndpoint: endpoint.origin,
  ideUrl,
  thresholds,
  cases: [],
};

const browser = await chromium.launch({ headless: true });
try {
  for (const testCase of cases) {
    const sourceBytes = await readFile(resolve(ROOT, testCase.source));
    const cold = await compile(testCase.name, sourceBytes.toString('utf8'));
    const warm = await compile(testCase.name, sourceBytes.toString('utf8'));
    assert.equal(warm.artifact.id, cold.artifact.id, 'Warm build must reuse the same compiler identity.');

    const wasmBytes = await downloadBytes(cold.artifact.wasmUrl);
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(ideUrl, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    assert.equal(await page.evaluate(() => crossOriginIsolated), true);

    const runtime = await page.evaluate(async ({ artifact, name }) => {
      const { createFastLedRuntime } = await import('/PXLBLZ-IDE/src/engine/fastled/index.ts');
      const frames = [];
      const frameTimes = [];
      let latestLayout = [];
      const failures = [];
      const initStarted = performance.now();
      const worker = await createFastLedRuntime({
        artifact,
        onFrame(frame) {
          frameTimes.push(performance.now());
          if (frames.length < 2) frames.push(new Uint8Array(frame));
          else frames[1] = new Uint8Array(frame);
        },
        onLayout(positions) { latestLayout = positions.map(([x, y]) => [x, y]); },
        onError(message) { failures.push(message); },
      });
      const initializationMs = performance.now() - initStarted;
      const gaps = [];
      let lastTick = performance.now();
      const timer = setInterval(() => {
        const now = performance.now();
        gaps.push(now - lastTick);
        lastTick = now;
      }, 10);
      worker.start();
      const runStarted = performance.now();
      const deadline = runStarted + 15_000;
      while ((frameTimes.length < 12 || latestLayout.length === 0) && performance.now() < deadline) {
        if (failures.length) throw new Error(failures.join('\n'));
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await new Promise(resolve => setTimeout(resolve, 750));
      worker.pause();
      clearInterval(timer);
      const runElapsedMs = performance.now() - runStarted;
      const beforeReset = frameTimes.length;
      worker.reset();
      worker.start();
      const resetDeadline = performance.now() + 12_000;
      while (frameTimes.length <= beforeReset && performance.now() < resetDeadline) {
        if (failures.length) throw new Error(failures.join('\n'));
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      const resetRecovered = frameTimes.length > beforeReset;
      worker.dispose();

      const first = frames[0] ?? new Uint8Array();
      const latest = frames[1] ?? first;
      const digest = async bytes => {
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
      };
      const samplePixels = {};
      for (const index of [0, 63, 255, 256, 4032, 4095, 511]) {
        if (index * 3 + 2 < first.length) samplePixels[index] = Array.from(first.slice(index * 3, index * 3 + 3));
      }
      const sampleLayout = {};
      for (const index of [0, 63, 255, 256, 4032, 4095, 511]) {
        if (index < latestLayout.length) sampleLayout[index] = latestLayout[index];
      }
      return {
        name,
        initializationMs,
        frameCount: frameTimes.length,
        frameBytes: first.length,
        firstFrameSha256: await digest(first),
        latestFrameSha256: await digest(latest),
        samplePixels,
        layoutCount: latestLayout.length,
        sampleLayout,
        steadyStateFps: frameTimes.length / (runElapsedMs / 1000),
        mainThreadMaxGapMs: gaps.length ? Math.max(...gaps) : null,
        resetRecovered,
        failures,
      };
    }, { artifact: cold.artifact, name: testCase.name });
    await page.close();

    assert.deepEqual(pageErrors, []);
    assert.deepEqual(runtime.failures, []);
    assert.equal(runtime.frameBytes, testCase.expectedPixels * 3);
    assert.equal(runtime.layoutCount, testCase.expectedPixels);
    assert.equal(runtime.resetRecovered, true);

    for (const [index, expected] of Object.entries(testCase.expectedFirstPixels || {})) {
      assert.deepEqual(runtime.samplePixels[index], expected, `${testCase.name} pixel ${index}`);
    }
    for (const [index, expected] of Object.entries(testCase.expectedLayoutSamples)) {
      const actual = runtime.sampleLayout[index];
      assert.ok(actual, `${testCase.name} missing layout sample ${index}`);
      assert.ok(Math.abs(actual[0] - expected[0]) < 1e-6 && Math.abs(actual[1] - expected[1]) < 1e-6,
        `${testCase.name} layout ${index}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
    }

    const performanceResult = {
      coldCompileMs: cold.elapsedMs,
      warmCompileMs: warm.elapsedMs,
      wasmBytes: wasmBytes.length,
      initializationMs: runtime.initializationMs,
      steadyStateFps: runtime.steadyStateFps,
      mainThreadMaxGapMs: runtime.mainThreadMaxGapMs,
    };
    assert.ok(performanceResult.coldCompileMs <= thresholds.coldCompileMsMax);
    assert.ok(performanceResult.warmCompileMs <= thresholds.warmCompileMsMax);
    assert.ok(performanceResult.wasmBytes <= thresholds.wasmBytesMax);
    assert.ok(performanceResult.initializationMs <= thresholds.initializationMsMax);
    assert.ok(performanceResult.steadyStateFps >= thresholds.steadyStateFpsMin);
    assert.ok(performanceResult.mainThreadMaxGapMs !== null && performanceResult.mainThreadMaxGapMs <= thresholds.mainThreadMaxGapMs);

    evidence.cases.push({
      name: testCase.name,
      source: { path: testCase.source, bytes: sourceBytes.length, sha256: sha256(sourceBytes) },
      artifactId: cold.artifact.id,
      wasmSha256: sha256(wasmBytes),
      performance: performanceResult,
      runtime,
      passed: true,
    });
  }
} finally {
  await browser.close();
}

evidence.passed = evidence.cases.every(item => item.passed);
await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
