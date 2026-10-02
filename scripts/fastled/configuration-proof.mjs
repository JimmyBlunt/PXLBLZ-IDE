import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const endpoint = new URL(process.env.FASTLED_COMPILER_URL || 'http://127.0.0.1:9982');
if (endpoint.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(endpoint.hostname)) {
  throw new Error('FASTLED_COMPILER_URL must target the local compiler service.');
}

const root = resolve(new URL('../../', import.meta.url).pathname);
const outPath = resolve(root, process.argv[2] || 'agent-a-configuration-proof.json');
const workRoot = resolve(root, '.fastled-agent-a-proof');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fixtures = [
  { name: 'hsv-spectrum', file: 'hsv-spectrum.ino', expected: [155, 95, 0] },
  { name: 'fastled-prototype-order', file: 'fastled-prototype-order.ino', expected: [17, 34, 51] },
];

await rm(workRoot, { recursive: true, force: true });
await mkdir(workRoot, { recursive: true });

const healthResponse = await fetch(new URL('/health', endpoint), { signal: AbortSignal.timeout(30_000) });
assert.equal(healthResponse.status, 200);
const health = await healthResponse.json();

const evidence = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  compilerEndpoint: endpoint.origin,
  health,
  fixtures: [],
};

for (const fixture of fixtures) {
  const started = performance.now();
  const sourcePath = resolve(root, 'scripts/fastled/fixtures', fixture.file);
  const source = await readFile(sourcePath);
  const response = await fetch(new URL('/compile', endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: fixture.name, source: source.toString('utf8') }),
    signal: AbortSignal.timeout(12 * 60_000),
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.diagnostics || body.error);
  assert.equal(body.fastledVersion, '3.10.4');
  assert.ok(body.runtimeUrl && body.wasmUrl && body.moduleUrl);

  const fixtureDir = resolve(workRoot, fixture.name);
  await mkdir(fixtureDir, { recursive: true });
  const assets = {};
  for (const field of ['runtimeUrl', 'wasmUrl']) {
    const url = new URL(body[field], endpoint);
    assert.equal(url.origin, endpoint.origin);
    const assetResponse = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    assert.equal(assetResponse.status, 200);
    const bytes = Buffer.from(await assetResponse.arrayBuffer());
    const file = resolve(fixtureDir, basename(url.pathname));
    await writeFile(file, bytes);
    assets[field] = { file: basename(file), bytes: bytes.length, sha256: sha256(bytes) };
  }

  const resultPath = resolve(fixtureDir, 'result.json');
  const run = spawnSync(process.execPath, [
    resolve(root, 'test/fastled/configuration/read-wasm.mjs'),
    resolve(fixtureDir, assets.runtimeUrl.file),
    resultPath,
  ], { cwd: root, encoding: 'utf8', timeout: 120_000 });

  assert.equal(run.status, 0, [run.stdout, run.stderr].filter(Boolean).join('\n'));
  const result = JSON.parse(await readFile(resultPath, 'utf8'));
  assert.deepEqual(result.rgb, fixture.expected);

  evidence.fixtures.push({
    name: fixture.name,
    source: { file: fixture.file, bytes: source.length, sha256: sha256(source) },
    expectedRgb: fixture.expected,
    actualRgb: result.rgb,
    artifactId: body.id,
    assets,
    diagnosticsSha256: sha256(body.diagnostics || ''),
    elapsedMs: Math.round(performance.now() - started),
  });
}

evidence.passed = true;
await writeFile(outPath, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
