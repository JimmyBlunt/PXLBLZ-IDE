import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { hashTree } from './source-hash.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cache = path.resolve(process.argv[2] ?? path.join(here, '.cache'));
const compiler = process.env.FASTLED_NATIVE_CXX ?? 'zig';
const prefix = path.basename(compiler).toLowerCase().startsWith('zig') ? ['c++'] : [];
const platformFlags = process.platform === 'win32' && path.basename(compiler).toLowerCase().includes('clang')
  ? ['--target=x86_64-w64-windows-gnu', '-stdlib=libc++'] : [];
const linkerFlags = platformFlags.length ? ['-fuse-ld=lld', '--rtlib=compiler-rt', '--unwindlib=libunwind', '-static'] : [];
const library = path.join(cache, 'FastLED');
const build = path.join(cache, 'native');
await mkdir(build, { recursive: true });
const flags = [...platformFlags, '-std=c++17', '-O1', '-fno-exceptions', '-fno-rtti', '-ffunction-sections', '-fdata-sections',
  '-DFASTLED_STUB_IMPL', '-DFASTLED_USE_STUB_ARDUINO', '-DFASTLED_NO_ATEXIT=1',
  '-DFASTLED_MULTITHREADED=0', '-DFASTLED_USE_PROGMEM=0', '-DFASTLED_HAS_ENGINE_EVENTS=1',
  `-I${library.replaceAll('\\', '/')}/src`, `-I${library.replaceAll('\\', '/')}/src/platforms/stub`];

function run(args, log) {
  return new Promise((resolve, reject) => {
    const child = spawn(compiler, [...prefix, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('exit', async code => {
      await writeFile(log, output);
      if (code !== 0) reject(new Error(`Native compiler exited ${code}; see ${log}\n${output.slice(-2500)}`));
      else resolve(output);
    });
  });
}
const sources = (await readdir(path.join(library, 'src/fl/build'))).filter(name => name.endsWith('.cpp')).sort();
const compilerVersion = await run(['--version'], path.join(build, 'compiler-version.log'));
const sourceDigest = (await hashTree(path.join(library, 'src'))).sha256;
const fingerprint = createHash('sha256').update(JSON.stringify({ compiler, compilerVersion, flags, sourceDigest })).digest('hex');
const manifestPath = path.join(build, 'build-manifest.json');
const previous = await readFile(manifestPath, 'utf8').then(JSON.parse).catch(() => null);
const objects = sources.map(name => path.join(build, `${name}.o`));
const jobs = Math.max(1, Math.min(4, Number(process.env.FASTLED_NATIVE_JOBS) || 2));
let cursor = 0;
let stopped = false;
const results = await Promise.allSettled(Array.from({ length: jobs }, async () => {
  while (!stopped) {
    const index = cursor++;
    if (index >= sources.length) return;
    const name = sources[index];
    const source = path.join(library, 'src/fl/build', name);
    const object = objects[index];
    const existing = await stat(object).catch(() => null);
    const objectFingerprint = await readFile(`${object}.fingerprint`, 'utf8').catch(() => null);
    if (existing && (previous?.fingerprint === fingerprint || objectFingerprint === fingerprint)) continue;
    console.log(`Compiling ${name}`);
    try {
      await run([...flags, '-c', source, '-o', object], `${object}.log`);
      await writeFile(`${object}.fingerprint`, fingerprint);
    } catch (error) { stopped = true; throw error; }
  }
}));
for (const result of results) if (result.status === 'rejected') throw result.reason;
await writeFile(manifestPath, `${JSON.stringify({ fingerprint, compiler, compilerVersion, flags, sourceDigest }, null, 2)}\n`);
const { examples } = JSON.parse(await readFile(path.join(cache, 'provenance.json'), 'utf8'));
for (const { name } of examples) {
  const sketch = path.join(cache, 'sketches', name, `${name}.ino`);
  const object = path.join(build, `${name}.o`);
  console.log(`Building native ${name}`);
  await run([...flags, '-x', 'c++', '-c', sketch, '-o', object], `${object}.log`);
  const executable = path.join(build, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
  const system = process.platform === 'win32' ? ['-lws2_32', '-lwinmm'] : ['-pthread'];
  await run([...platformFlags, ...linkerFlags, object, ...objects, '-Wl,--gc-sections', ...system, '-o', executable], `${executable}.log`);
}
