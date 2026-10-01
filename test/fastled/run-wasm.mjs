import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const [, , modulePath, logPath, count = '120', advance = '16667'] = process.argv;
if (!modulePath || !logPath) throw new Error('Usage: node test/fastled/run-wasm.mjs fastled.js output.log [steps] [advanceUs]');
const absolute = path.resolve(modulePath);
let source = await readFile(absolute, 'utf8');
// The compiler-service adds this ESM export for the browser adapter. Emscripten's
// original classic factory also supports CommonJS; use that branch in Node.
source = source.replace(/\nexport default fastled;?\s*$/, '\n');
// A real .cjs file also lets Emscripten pthread workers load the same CommonJS
// runtime inside this repository's otherwise ESM package scope.
const commonJsPath = path.join(path.dirname(absolute), 'fastled.parity.cjs');
await writeFile(commonJsPath, source);
const factory = createRequire(commonJsPath)(commonJsPath);
if (typeof factory !== 'function') throw new Error('Expected Emscripten fastled factory');
const lines = [];
const instance = await factory({
  noInitialRun: true,
  mainScriptUrlOrBlob: commonJsPath,
  locateFile: file => path.join(path.dirname(absolute), file),
  print: text => lines.push(text),
  printErr: text => lines.push(`STDERR ${text}`),
});
for (const name of ['_pxlblz_test_setup', '_pxlblz_test_step']) {
  if (typeof instance[name] !== 'function') throw new Error(`Missing test instrumentation export ${name}`);
}
await instance._pxlblz_test_setup(1337);
for (let step = 0; step < Number(count); step++) await instance._pxlblz_test_step(Number(advance));
await writeFile(logPath, `${lines.join('\n')}\n`);
console.log(`Wrote ${lines.filter(line => line.startsWith('PXLFRAME ')).length} show snapshots to ${logPath}`);
// This file is an isolated test subprocess. EXIT_RUNTIME=0 and pthread pools
// intentionally keep the product alive; all evidence has now been flushed.
process.exit(0);
