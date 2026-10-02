import { createHash } from 'node:crypto';
import console from 'node:console';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { performance } from 'node:perf_hooks';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { fetch } = globalThis;
const endpoint = new URL(process.env.FASTLED_COMPILER_URL || 'http://127.0.0.1:9982');
if (endpoint.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(endpoint.hostname) || endpoint.username || endpoint.password) {
  throw new Error('FASTLED_COMPILER_URL must be a local HTTP compiler service.');
}
const outputPath = resolve(ROOT, process.argv[2] || 'docs/fastled/production-compile-proof.json');
const upstreamPath = process.env.FASTLED_PATH;
const names = ['Blink', 'ColorPalette', 'Fire2012', 'DemoReel100', 'Noise', 'NoisePlusPalette'];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const evidence = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  target: 'Official FastLED PC/WASM compiler, original examples and production frame adapter',
  frameAdapterSha256: sha256(await readFile(resolve(ROOT, 'scripts/fastled/frame-adapter.h'))),
  upstreamFilesVerified: Boolean(upstreamPath),
  examples: [],
};

async function save() {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n');
}

for (const name of names) {
  const started = performance.now();
  const deadline = Date.now() + 12 * 60 * 1000;
  const record = { name, inputs: [], attempts: [], status: 'failed' };
  evidence.examples.push(record);
  console.log(`Compiling original ${name} through ${endpoint.origin} ...`);
  try {
    const inputNames = [`${name}.ino`, ...(name === 'NoisePlusPalette' ? [`${name}.h`] : [])];
    const contents = {};
    for (const filename of inputNames) {
      const bytes = await readFile(resolve(ROOT, 'src/engine/fastled/examples', filename));
      if (upstreamPath) {
        const upstream = await readFile(resolve(upstreamPath, 'examples', name, filename));
        if (!bytes.equals(upstream)) throw new Error(`${filename} differs from the pinned upstream example.`);
      }
      record.inputs.push({ filename, bytes: bytes.length, sha256: sha256(bytes) });
      contents[filename] = bytes.toString('utf8');
    }
    const source = contents[`${name}.ino`];
    delete contents[`${name}.ino`];
    let artifact;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const response = await fetch(new URL('/compile', endpoint), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, source, files: contents }),
        signal: globalThis.AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
      const body = await response.json();
      record.attempts.push({ status: response.status, diagnosticsSha256: sha256(body.diagnostics || '') });
      if (response.ok) {
        artifact = body;
        break;
      }
      const rayonTransient = response.status === 422 && String(body.diagnostics).includes('rayon thread-pool too busy or dependency loop detected');
      if (attempt === 1 && rayonTransient && Date.now() < deadline) {
        record.attempts.at(-1).retryReason = 'Exact upstream Rayon fingerprint traversal failure; one unchanged retry within the same deadline.';
        console.log(`${name}: retrying the exact upstream Rayon fingerprint failure once.`);
        continue;
      }
      throw new Error(`${response.status}: ${body.diagnostics || body.error}`);
    }
    if (!artifact?.wasmUrl || !artifact.moduleUrl || !artifact.runtimeUrl) throw new Error('Compiler did not return all required runtime assets.');
    const assets = [];
    for (const field of ['moduleUrl', 'runtimeUrl', 'wasmUrl']) {
      const url = new URL(artifact[field], endpoint);
      if (url.origin !== endpoint.origin) throw new Error('Compiler returned an asset on another origin.');
      const response = await fetch(url, { signal: globalThis.AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
      if (!response.ok) throw new Error(`Asset download failed: ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      assets.push({ kind: field, filename: url.pathname.split('/').at(-1), bytes: bytes.length, sha256: sha256(bytes) });
    }
    Object.assign(record, {
      status: 'passed', artifactId: artifact.id, fastledVersion: artifact.fastledVersion, assets,
      compilationNotes: String(artifact.diagnostics || '').split(/\r?\n/).filter((line) => /^(Used unchanged|Retried once)/.test(line)),
    });
    console.log(`${name}: passed (${artifact.id}).`);
  } catch (error) {
    record.error = String(error.message || error).slice(-8192);
    console.error(`${name}: ${record.error}`);
    process.exitCode = 1;
  }
  record.elapsedMs = Math.round(performance.now() - started);
  await save();
}
evidence.completedAt = new Date().toISOString();
evidence.passed = evidence.examples.every((item) => item.status === 'passed');
await save();
console.log(`Production compiler evidence written to ${outputPath}`);
