import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const [runtimeArg, outputArg] = process.argv.slice(2);
if (!runtimeArg || !outputArg) throw new Error('Usage: read-wasm.mjs <runtime.cjs> <result.json>');
const runtime = path.resolve(runtimeArg);
const factory = createRequire(runtime)(runtime);
const module = await factory({
  noInitialRun: true,
  mainScriptUrlOrBlob: runtime,
  locateFile: file => path.join(path.dirname(runtime), file),
  print: () => {},
  printErr: text => process.stderr.write(`${text}\n`),
});
await module._extern_setup();
await module._extern_loop();
const sizePointer = module._malloc(4);
if (!sizePointer) throw new Error('WASM allocation failed');
const pointer = module._getStripPixelData(0, sizePointer);
const length = new DataView(module.HEAPU8.buffer).getInt32(sizePointer, true);
if (length !== 3 || pointer <= 0 || pointer + length > module.HEAPU8.byteLength) {
  throw new Error('Configuration fixtures must emit exactly one RGB pixel');
}
const rgb = Array.from(module.HEAPU8.slice(pointer, pointer + length));
module._free(sizePointer);
await writeFile(outputArg, JSON.stringify({ rgb }) + '\n');
// Terminate only this test subprocess after its threaded runtime is observed.
process.exit(0);
