import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrames, compareFrames } from './compare.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('Usage: node test/fastled/run-corpus.mjs <wasm-module-manifest.json> [cache-directory]');
const modules = JSON.parse(await readFile(manifestPath, 'utf8'));
const cache = path.resolve(process.argv[3] ?? path.join(here, '.cache'));
const provenance = JSON.parse(await readFile(path.join(cache, 'provenance.json'), 'utf8'));
const output = path.join(cache, 'evidence');
await mkdir(output, { recursive: true });
const report = { contract: provenance.contract, fastled: provenance.fastled, startedAt: new Date().toISOString(), examples: [] };
await writeFile(path.join(output, 'report.json'), `${JSON.stringify({ ...report, complete: false }, null, 2)}\n`);

// Long runs cross the official ten-second DemoReel switches and the complete
// ColorPalette minute. Other effects still exercise many seeded noise frames.
const steps = { Blink: 12, ColorPalette: 3000, Fire2012: 300, DemoReel100: 3600, Noise: 300, NoisePlusPalette: 300 };
for (const { name } of provenance.examples) {
  if (typeof modules[name] !== 'string' || !steps[name]) throw new Error(`Missing WASM artifact or run specification for ${name}`);
}
function execute(command, args, logPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let errors = '';
    const deadline = setTimeout(() => child.kill(), 120000);
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', error => { clearTimeout(deadline); reject(error); });
    child.on('exit', async code => {
      clearTimeout(deadline);
      const stdout = Buffer.concat(chunks).toString('utf8');
      await writeFile(logPath, stdout);
      await writeFile(`${logPath}.stderr`, errors);
      if (code !== 0) reject(new Error(`${command} exited ${code}: ${errors.slice(-2000)}`));
      else resolve(stdout);
    });
  });
}
function checkProvenance(text, example, target) {
  const records = text.split(/\r?\n/).filter(line => line.startsWith('PXLPROVENANCE '));
  if (records.length !== 1) throw new Error(`${example.name} ${target}: expected one embedded source provenance record`);
  const embedded = JSON.parse(records[0].slice(14));
  if (embedded.example !== example.name || embedded.sourceSha256 !== example.sourceTreeSha256 || embedded.seed !== 1337) {
    throw new Error(`${example.name} ${target}: executable source provenance differs from prepared corpus`);
  }
}
for (const example of provenance.examples) {
  const { name } = example;
  console.log(`Comparing ${name} (${steps[name]} loops)`);
  const nativeLog = path.join(output, `${name}.native.log`);
  const wasmLog = path.join(output, `${name}.wasm.log`);
  const executable = path.join(cache, 'native', `${name}${process.platform === 'win32' ? '.exe' : ''}`);
  const native = await execute(executable, [String(steps[name]), '16667'], nativeLog);
  await execute(process.execPath, [path.join(here, 'run-wasm.mjs'), path.resolve(modules[name]), wasmLog, String(steps[name]), '16667'], `${wasmLog}.runner`);
  const wasm = await readFile(wasmLog, 'utf8');
  checkProvenance(native, example, 'native');
  checkProvenance(wasm, example, 'wasm');
  const frames = parseFrames(native);
  const comparison = compareFrames(frames, parseFrames(wasm));
  const result = { name, loops: steps[name], ...comparison, lastVirtualTimeUs: frames.at(-1).timeUs, sourceFiles: example.sourceFiles };
  report.examples.push(result);
  console.log(JSON.stringify(result));
  // Durable partial evidence remains explicitly partial until every case passes.
  await writeFile(path.join(output, 'partial-report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
await writeFile(path.join(output, 'report.json'), `${JSON.stringify({ ...report, complete: true }, null, 2)}\n`);
