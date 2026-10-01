import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, copyFile, writeFile, stat, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

export const FASTLED_VERSION = '3.10.4';
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ORIGINS = ['http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:5184', 'http://127.0.0.1:5184'];
const SOURCE_LIMIT = 1024 * 1024;
const LOG_LIMIT = 128 * 1024;

export class CompileError extends Error {
  constructor(message, status = 422, diagnostics = message) {
    super(message);
    this.status = status;
    this.diagnostics = diagnostics;
  }
}

/** Spawn only the compiler, never a compiled native executable or a shell. */
export function runCompiler(command, args, { cwd, timeoutMs, env = process.env }) {
  return new Promise((resolveRun, reject) => {
    let output = '';
    let timedOut = false;
    const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const collect = (chunk) => { output = (output + chunk.toString()).slice(-LOG_LIMIT); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      timedOut = true;
      // taskkill is an argv-only OS tool; Windows compiler children must not be
      // left running after their launcher is killed.
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else child.kill('SIGKILL');
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(new CompileError(`Cannot start FastLED compiler: ${error.message}`, 503));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new CompileError('FastLED compilation timed out.', 504, output));
      else if (code !== 0) reject(new CompileError('FastLED compilation failed.', 422, output));
      else resolveRun(output);
    });
  });
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) files.push(...await filesUnder(join(directory, entry.name)));
    else if (entry.isFile()) files.push(join(directory, entry.name));
  }
  return files;
}

/** No request can supply compiler options, paths, environment, or build scripts. */
export function createCompiler(options = {}) {
  const cacheRoot = resolve(options.cacheRoot ?? join(tmpdir(), 'pxlblz-fastled-3.10.4'));
  const fastledPath = options.fastledPath ?? process.env.FASTLED_PATH;
  const command = options.command ?? process.env.FASTLED_CLI ?? 'fastled';
  const run = options.run ?? runCompiler;
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const maxPending = options.maxPending ?? 3;
  const inFlight = new Map();
  let tail = Promise.resolve();
  let pending = 0;

  async function compile(source) {
    if (typeof source !== 'string' || !source.trim()) throw new CompileError('source must be a non-empty string.', 400);
    if (Buffer.byteLength(source) > SOURCE_LIMIT) throw new CompileError('Sketch exceeds the 1 MiB limit.', 413);
    if (!fastledPath) throw new CompileError('Set FASTLED_PATH to the pinned FastLED 3.10.4 source checkout.', 503);
    const properties = await readFile(join(fastledPath, 'library.properties'), 'utf8').catch(() => '');
    if (!/^version=3\.10\.4\s*$/m.test(properties)) throw new CompileError('FASTLED_PATH must contain FastLED version 3.10.4.', 503);
    const adapter = await readFile(join(HERE, 'frame-adapter.h'), 'utf8');
    const id = createHash('sha256').update(FASTLED_VERSION + '\0' + adapter + '\0' + source).digest('hex');
    const directory = join(cacheRoot, 'builds', id);
    const manifestPath = join(directory, 'manifest.json');
    const cached = await readFile(manifestPath, 'utf8').then(JSON.parse).catch(() => null);
    if (cached && await stat(join(directory, 'module.mjs')).catch(() => null)) return cached;
    if (inFlight.has(id)) return inFlight.get(id);
    if (pending >= maxPending) throw new CompileError('Compiler queue is full. Try again after the current build.', 429);
    pending++;
    const build = tail.catch(() => {}).then(async () => {
      await mkdir(join(cacheRoot, 'work'), { recursive: true });
      const work = await mkdtemp(join(cacheRoot, 'work', 'build-'));
      try {
      const sketch = join(work, 'Sketch');
      await mkdir(sketch);
      // Append after the sketch so its FASTLED_* preprocessor configuration
      // remains effective before the first FastLED.h include.
      await writeFile(join(sketch, 'Sketch.ino'), '#line 1 "Sketch.ino"\n' + source + '\n#include "pxlblz-frame-adapter.h"\n');
      await writeFile(join(sketch, 'pxlblz-frame-adapter.h'), adapter);
      const args = [sketch, '--just-compile', '--no-app', '--no-interactive', '--fastled-path', resolve(fastledPath)];
      const diagnostics = await run(command, args, { cwd: work, timeoutMs });
      const files = await filesUnder(work);
      const candidates = files.filter((file) => /(?:fastled|sketch)\.(?:js|mjs)$/i.test(basename(file)));
      let modulePath;
      for (const file of candidates) {
        const contents = await readFile(file, 'utf8');
        if (contents.includes('wasm') && (contents.includes('fastled') || contents.includes('export default'))) { modulePath = file; break; }
      }
      if (!modulePath) throw new CompileError('Compiler produced no recognizable FastLED JavaScript module.', 502, diagnostics);
      const outputDir = dirname(modulePath);
      await mkdir(directory, { recursive: true });
      for (const file of await readdir(outputDir, { withFileTypes: true })) {
        if (file.isFile() && /\.(?:js|mjs|wasm|data|mem)$/.test(file.name)) await copyFile(join(outputDir, file.name), join(directory, file.name));
      }
      const original = await readFile(modulePath, 'utf8');
      // Upstream -sMODULARIZE=1 -sEXPORT_NAME=fastled emits a classic factory.
      // The wrapper is a separate asset: original compiler output is retained.
      await writeFile(join(directory, 'module.mjs'), /\bexport\s+default\b/.test(original) ? original : original + '\nexport default fastled;\n');
      const wasmFile = (await readdir(directory)).find((file) => file.endsWith('.wasm'));
      const result = { id, moduleUrl: `/builds/${id}/module.mjs`, ...(wasmFile ? { wasmUrl: `/builds/${id}/${wasmFile}` } : {}), diagnostics, fastledVersion: FASTLED_VERSION };
      await writeFile(manifestPath, JSON.stringify(result));
      return result;
      } finally {
        // Only delete the exact generated work directory inside this cache.
        if (resolve(work).startsWith(resolve(cacheRoot, 'work') + sep)) await rm(work, { recursive: true, force: true });
      }
    }).finally(() => { pending--; inFlight.delete(id); });
    inFlight.set(id, build);
    tail = build;
    return build;
  }
  return { compile, cacheRoot, get pending() { return pending; } };
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw new CompileError('Content-Type must be application/json.', 415);
  if (Number(request.headers['content-length']) > SOURCE_LIMIT + 65536) throw new CompileError('Request too large.', 413);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > SOURCE_LIMIT + 65536) throw new CompileError('Request too large.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new CompileError('Request must contain valid JSON.', 400); }
}

export function createCompilerServer(options = {}) {
  const compiler = options.compiler ?? createCompiler(options);
  const allowedOrigins = new Set(options.origins ?? DEFAULT_ORIGINS);
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    const host = request.headers.host ?? '';
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host)) return json(response, 403, { error: 'Loopback Host required.' });
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return json(response, 403, { error: 'Origin is not allowed.' });
    if (origin) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return response.writeHead(204).end();
    }
    try {
      const path = new URL(request.url, `http://${host}`).pathname;
      if (request.method === 'GET' && path === '/health') return json(response, 200, { status: 'ok', fastledVersion: FASTLED_VERSION, pending: compiler.pending });
      if (request.method === 'POST' && path === '/compile') {
        const body = await readJson(request);
        const result = await compiler.compile(body?.source);
        const base = `http://${host}`;
        return json(response, 200, { ...result, moduleUrl: base + result.moduleUrl, ...(result.wasmUrl ? { wasmUrl: base + result.wasmUrl } : {}) });
      }
      const match = /^\/builds\/([a-f0-9]{64})\/([\w.-]+\.(?:mjs|js|wasm|data|mem))$/.exec(path);
      if (request.method === 'GET' && match) {
        const file = join(compiler.cacheRoot, 'builds', match[1], match[2]);
        const fileStat = await stat(file).catch(() => null);
        if (!fileStat?.isFile()) return json(response, 404, { error: 'Build asset not found.' });
        const type = extname(file) === '.wasm' ? 'application/wasm' : /\.m?js$/.test(file) ? 'text/javascript' : 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': type, 'Content-Length': fileStat.size, 'Cache-Control': 'public, max-age=31536000, immutable' });
        const stream = createReadStream(file);
        stream.on('error', () => response.destroy());
        stream.pipe(response);
        return;
      }
      return json(response, 404, { error: 'Not found.' });
    } catch (error) {
      json(response, error instanceof CompileError ? error.status : 500, { error: error.message, diagnostics: error.diagnostics ?? '' });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.FASTLED_PORT ?? 9981);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('FASTLED_PORT must be a valid port.');
  const origins = process.env.FASTLED_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean);
  createCompilerServer({ origins }).listen(port, '127.0.0.1', () => {
    process.stdout.write(`PXLBLZ FastLED compiler listening at http://127.0.0.1:${port}\n`);
  });
}
