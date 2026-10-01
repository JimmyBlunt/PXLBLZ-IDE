import { cp, mkdir, readFile, readdir, writeFile, symlink, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashTree } from './source-hash.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
async function copyDirectory(source, destination) {
  if (process.platform !== 'win32') return cp(source, destination, { recursive: true });
  await new Promise((resolve, reject) => {
    // Robocopy's parallel copier avoids thousands of sequential filesystem
    // round trips on Windows. No /MIR or /PURGE: this never removes files.
    const child = spawn('robocopy', [source, destination, '/E', '/MT:8', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1'], { windowsHide: true, stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', code => code !== null && code < 8 ? resolve() : reject(new Error(`robocopy failed with exit ${code}`)));
  });
}
const positional = process.argv.slice(2).filter(value => !value.startsWith('--'));
const upstream = path.resolve(positional[0] ?? '');
const out = path.resolve(positional[1] ?? path.join(here, '.cache'));
if (!positional[0]) throw new Error('Usage: node test/fastled/prepare.mjs <FastLED-3.10.4> [output] [--reuse-source] [--with-build-tooling] [--share-python-env]');
const properties = await readFile(path.join(upstream, 'library.properties'), 'utf8');
if (!/^version=3\.10\.4\r?$/m.test(properties)) throw new Error('Expected pinned FastLED 3.10.4');
const library = path.join(out, 'FastLED');
await mkdir(library, { recursive: true });
// Reuse only the toolchain environment, never the upstream source/build cache.
// The actual Python executable avoids the CLI's Windows .cmd fallback, which
// truncates Meson's multiline source-cache argument after its first line.
if (process.argv.includes('--share-python-env')) {
  const environment = await realpath(path.join(upstream, '.venv'));
  await stat(path.join(environment, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'));
  const target = path.join(library, '.venv');
  const existing = await realpath(target).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existing && existing !== environment) throw new Error(`Existing test Python environment differs: ${target}`);
  if (!existing) await symlink(environment, target, process.platform === 'win32' ? 'junction' : 'dir');
}
if (!process.argv.includes('--reuse-source')) {
  await copyDirectory(path.join(upstream, 'src'), path.join(library, 'src'));
}
for (const name of ['library.properties', 'library.json', 'LICENSE']) {
  await cp(path.join(upstream, name), path.join(library, name));
}
for (const entry of await readdir(upstream, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.startsWith('meson')) {
    await cp(path.join(upstream, entry.name), path.join(library, entry.name));
  }
}
await copyDirectory(path.join(upstream, 'ci'), path.join(library, 'ci'));
// Optional upstream developer tooling. The CLI otherwise uses its own build
// implementation and ambient Node, avoiding a second development environment.
if (process.argv.includes('--with-build-tooling')) {
  for (const entry of await readdir(upstream, { withFileTypes: true })) {
    if (entry.isFile() && /\.(py|toml|lock)$/.test(entry.name)) {
      await cp(path.join(upstream, entry.name), path.join(library, entry.name));
    }
  }
  await copyDirectory(path.join(upstream, 'tools'), path.join(library, 'tools'));
}

const platformClock = `#pragma once
#include "fl/stl/stdint.h"
extern "C" unsigned int pxlblz_test_time_us;
namespace fl { namespace platforms {
void delay(fl::u32 ms) { pxlblz_test_time_us += ms * 1000u; }
void delayMicroseconds(fl::u32 us) { pxlblz_test_time_us += us; }
fl::u32 millis() { return pxlblz_test_time_us / 1000u; }
fl::u32 micros() { return pxlblz_test_time_us; }
} }
`;
await writeFile(path.join(library, 'src/platforms/stub/platform_time.cpp.hpp'), `#include "platforms/wasm/is_wasm.h"\n#if defined(FASTLED_STUB_IMPL) && !defined(FL_IS_WASM)\n${platformClock}\n#endif\n`);
await writeFile(path.join(library, 'src/platforms/wasm/platform_time.cpp.hpp'), `#include "platforms/wasm/is_wasm.h"\n#ifdef FL_IS_WASM\n${platformClock}\n#endif\n`);
await writeFile(path.join(library, 'src/platforms/wasm/timer.cpp.hpp'), `#include "platforms/wasm/is_wasm.h"
#ifdef FL_IS_WASM
#include "fl/stl/stdint.h"
extern "C" unsigned int pxlblz_test_time_us;
extern "C" {
fl::u32 millis() { return pxlblz_test_time_us / 1000u; }
fl::u32 micros() { return pxlblz_test_time_us; }
void yield() {}
}
#endif
`);
const arduinoPath = path.join(library, 'src/platforms/stub/Arduino.cpp.hpp');
let arduino = await readFile(arduinoPath, 'utf8');
if (arduino.includes('rand() % range')) {
  arduino = 'extern "C" unsigned int pxlblz_test_random();\n' + arduino.replace('rand() % range', 'pxlblz_test_random() % range');
} else if (!arduino.includes('pxlblz_test_random() % range')) {
  throw new Error('Pinned Arduino random implementation changed');
}
await writeFile(arduinoPath, arduino);
// Bypass task pumping for a deterministic delay input. Pumping a wall-clock
// executor until a frozen virtual deadline would otherwise never finish.
const delayPath = path.join(library, 'src/fl/system/delay.cpp.hpp');
const delay = await readFile(delayPath, 'utf8');
const delayPattern = /void delay_impl\(u32 ms, bool run_async\) FL_NOEXCEPT \{[\s\S]*?\n\}/;
if (!delayPattern.test(delay)) throw new Error('Pinned delay implementation changed');
await writeFile(delayPath, delay.replace(delayPattern, 'void delay_impl(u32 ms, bool run_async) FL_NOEXCEPT {\n  (void)run_async;\n  fl::platforms::delay(ms);\n}'));

const examples = ['Blink', 'ColorPalette', 'Fire2012', 'DemoReel100', 'Noise', 'NoisePlusPalette'];
const provenance = { fastled: '3.10.4', contract: 'logical-crgb-at-every-show', examples: [] };
for (const name of examples) {
  const original = path.join(upstream, 'examples', name, `${name}.ino`);
  const source = await readFile(original, 'utf8');
  const sourceTree = await hashTree(path.join(upstream, 'examples', name));
  const folder = path.join(out, 'sketches', name);
  await mkdir(folder, { recursive: true });
  await cp(path.join(upstream, 'examples', name), folder, { recursive: true });
  await cp(path.join(here, 'parity-runtime.hpp'), path.join(folder, 'parity-runtime.hpp'));
  await writeFile(path.join(folder, 'original-sketch.hpp'), source);
  // Original source is included verbatim. Only its entrypoint symbols change.
  await writeFile(path.join(folder, `${name}.ino`), `#include <Arduino.h>
#include <FastLED.h>
#define setup pxlblz_sketch_setup
#define loop pxlblz_sketch_loop
#include "original-sketch.hpp"
#undef setup
#undef loop
#define PXL_TEST_EXAMPLE "${name}"
#define PXL_TEST_SOURCE_SHA256 "${sourceTree.sha256}"
#include "parity-runtime.hpp"
void setup() { pxlblz_test_setup(1337); }
void loop() { pxlblz_test_step(16667); }
`);
  provenance.examples.push({ name, sha256: createHash('sha256').update(source).digest('hex'), sourceTreeSha256: sourceTree.sha256, sourceFiles: sourceTree.files });
}
await writeFile(path.join(out, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
console.log(JSON.stringify({ library, sketches: path.join(out, 'sketches'), provenance }, null, 2));
