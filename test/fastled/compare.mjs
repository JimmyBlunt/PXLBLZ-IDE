import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function parseFrames(text) {
  return text.split(/\r?\n/).filter(line => line.startsWith('PXLFRAME ')).map((line, index) => {
    const frame = JSON.parse(line.slice(9));
    if (!Number.isInteger(frame.timeUs) || !Number.isInteger(frame.strip)
        || !Number.isInteger(frame.brightness) || !Array.isArray(frame.rgb)
        || frame.rgb.length === 0 || frame.rgb.length % 3 !== 0
        || frame.rgb.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new Error(`Malformed frame ${index}`);
    }
    return frame;
  });
}

export function compareFrames(native, wasm) {
  if (!native.length || !wasm.length) throw new Error('Both executions must emit at least one frame');
  if (native.length !== wasm.length) throw new Error(`Frame count differs: native=${native.length}, wasm=${wasm.length}`);
  let bytes = 0;
  for (let i = 0; i < native.length; i++) {
    const a = native[i];
    const b = wasm[i];
    for (const key of ['timeUs', 'strip', 'brightness']) {
      if (a[key] !== b[key]) throw new Error(`Frame ${i} ${key}: native=${a[key]}, wasm=${b[key]}`);
    }
    if (a.rgb.length !== b.rgb.length) throw new Error(`Frame ${i} pixel count differs`);
    for (let channel = 0; channel < a.rgb.length; channel++) {
      if (a.rgb[channel] !== b.rgb[channel]) {
        throw new Error(`Frame ${i}, strip ${a.strip}, pixel ${Math.floor(channel / 3)}, ${'RGB'[channel % 3]}: native=${a.rgb[channel]}, wasm=${b.rgb[channel]}`);
      }
    }
    bytes += a.rgb.length;
  }
  return { frames: native.length, comparedBytes: bytes, exact: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , nativePath, wasmPath] = process.argv;
  if (!nativePath || !wasmPath) throw new Error('Usage: node test/fastled/compare.mjs native.log wasm.log');
  console.log(JSON.stringify(compareFrames(parseFrames(readFileSync(nativePath, 'utf8')), parseFrames(readFileSync(wasmPath, 'utf8'))), null, 2));
}
