/* global fetch */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { setImmediate } from 'node:timers';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createCompiler, createCompilerServer, CompileError, runCompiler } from './server.mjs';

async function fixture(t, run) {
  const root = await mkdtemp(join(tmpdir(), 'pxlblz-compiler-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = join(root, 'library');
  await mkdir(library);
  await writeFile(join(library, 'library.properties'), 'version=3.10.4\n');
  const compiler = createCompiler({ cacheRoot: root, fastledPath: library, run });
  return { root, library, compiler };
}

async function fakeCompile(_command, args) {
  assert.ok(args.includes('--just-compile'));
  assert.ok(args.includes('--no-app'));
  assert.ok(args.includes('--no-interactive'));
  const output = join(args[0], 'fastled_js');
  await mkdir(output);
  await writeFile(join(output, 'fastled.js'), 'var fastled = async () => ({ wasm: true });');
  await writeFile(join(output, 'fastled.wasm'), Buffer.from([0, 97, 115, 109]));
  return 'Compiled test sketch';
}

test('same source compiles once and produces an importable factory and adjacent wasm', async (t) => {
  let runs = 0;
  const { root, compiler } = await fixture(t, async (...args) => { runs++; return fakeCompile(...args); });
  const [first, second] = await Promise.all([compiler.compile('void setup(){} void loop(){}'), compiler.compile('void setup(){} void loop(){}')]);
  assert.deepEqual(first, second);
  assert.equal(runs, 1);
  assert.equal(first.fastledVersion, '3.10.4');
  assert.match(first.moduleUrl, /^\/builds\/[a-f0-9]{64}\/module\.mjs$/);
  assert.equal(await readFile(join(root, first.moduleUrl), 'utf8'), 'var fastled = async () => ({ wasm: true });\nexport default fastled;\n');
  await compiler.compile('void setup(){} void loop(){}');
  assert.equal(runs, 1);
});

test('compiles are serialized and queue overload is explicit', async (t) => {
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  let active = 0;
  const { compiler } = await fixture(t, async (...args) => {
    assert.equal(++active, 1);
    await barrier;
    const result = await fakeCompile(...args);
    active--;
    return result;
  });
  const jobs = [compiler.compile('one'), compiler.compile('two'), compiler.compile('three')];
  while (compiler.pending < 3) await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(compiler.compile('four'), { status: 429 });
  release();
  await Promise.all(jobs);
  assert.equal(compiler.pending, 0);
});

test('failed compile preserves diagnostics and does not poison queue', async (t) => {
  let fail = true;
  const { compiler } = await fixture(t, async (...args) => {
    if (fail) throw new CompileError('compile failed', 422, 'Sketch.ino:3: missing semicolon');
    return fakeCompile(...args);
  });
  await assert.rejects(compiler.compile('bad source'), { diagnostics: 'Sketch.ino:3: missing semicolon' });
  fail = false;
  assert.equal((await compiler.compile('good source')).fastledVersion, '3.10.4');
  await assert.rejects(compiler.compile(''), { status: 400 });
  await assert.rejects(compiler.compile('x'.repeat(1024 * 1024 + 1)), { status: 413 });
});

test('sketch configuration precedes the adapter and a wrong library version is refused', async (t) => {
  const source = '#define FASTLED_SCALE8_FIXED 0\n#include <FastLED.h>\nvoid setup(){} void loop(){}';
  const { compiler, library } = await fixture(t, async (...args) => {
    const sketch = await readFile(join(args[1][0], 'Sketch.ino'), 'utf8');
    assert.equal(sketch, '#line 1 "Sketch.ino"\n' + source + '\n#include "pxlblz-frame-adapter.h"\n');
    return fakeCompile(...args);
  });
  await compiler.compile(source);
  await writeFile(join(library, 'library.properties'), 'version=3.10.3\n');
  await assert.rejects(compiler.compile(source), { status: 503 });
});

test('HTTP enforces local origin, host, JSON, and asset path boundaries', async (t) => {
  const { compiler } = await fixture(t, fakeCompile);
  const server = createCompilerServer({ compiler });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const blocked = await fetch(base + '/compile', { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{"source":"valid"}' });
  assert.equal(blocked.status, 403);
  const wrongHost = await new Promise((resolve, reject) => {
    const req = request(base + '/health', { headers: { Host: 'untrusted.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(wrongHost, 403);
  assert.equal((await fetch(base + '/compile', { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await fetch(base + '/compile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })).status, 400);
  const response = await fetch(base + '/compile', { method: 'POST', headers: { Origin: 'http://localhost:5174', 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'void setup(){} void loop(){}' }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5174');
  const artifact = await response.json();
  assert.ok(artifact.moduleUrl.startsWith(base));
  assert.equal((await fetch(artifact.wasmUrl)).headers.get('content-type'), 'application/wasm');
  assert.equal((await fetch(base + `/builds/${artifact.id}/manifest.json`)).status, 404);
  assert.equal((await fetch(base + '/builds/../../library/library.properties')).status, 404);
});

test('process failure and timeout return bounded diagnostics', async () => {
  await assert.rejects(runCompiler(process.execPath, ['-e', 'console.error("compiler-error");process.exit(2)'], { timeoutMs: 5000 }), (error) => error.status === 422 && error.diagnostics.includes('compiler-error'));
  await assert.rejects(runCompiler(process.execPath, ['-e', 'setInterval(()=>{},100)'], { timeoutMs: 50 }), { status: 504 });
});
