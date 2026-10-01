import { mkdir, readFile, writeFile, access, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cache = path.resolve(process.argv[2] ?? path.join(here, '.cache'));
const library = path.join(cache, 'FastLED');
const cli = process.env.FASTLED_CLI ?? 'fastled';
const provenance = JSON.parse(await readFile(path.join(cache, 'provenance.json'), 'utf8'));
const output = path.join(cache, 'wasm');
await mkdir(output, { recursive: true });
const manifest = {};
// Replace any earlier complete manifest before starting a new compilation.
await writeFile(path.join(output, 'modules.json'), '{}\n');
for (const { name } of provenance.examples) {
  const sketch = path.join(cache, 'sketches', name);
  console.log(`Building WASM ${name}`);
  for (let attempt = 1; ; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(cli, [sketch, '--just-compile', '--no-app', '--no-interactive', '--link', 'static', '--fastled-path', library], {
          windowsHide: true,
          env: { ...process.env, UV_NO_SYNC: '1', RAYON_NUM_THREADS: process.env.RAYON_NUM_THREADS ?? '4', EMCC_CORES: process.env.EMCC_CORES ?? '2' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let log = '';
        const deadline = setTimeout(() => child.kill(), 20 * 60 * 1000);
        child.stdout.on('data', chunk => { log += chunk; });
        child.stderr.on('data', chunk => { log += chunk; });
        child.on('error', error => { clearTimeout(deadline); reject(error); });
        child.on('close', async code => {
          clearTimeout(deadline);
          try {
            await writeFile(path.join(output, `${name}.build.log`), log);
            await writeFile(path.join(output, `${name}.attempt-${attempt}.log`), log);
            if (code !== 0) throw new Error(`${name} WASM compiler exited ${code}: ${log.slice(-3000)}`);
            resolve();
          } catch (error) { reject(error); }
        });
      });
      break;
    } catch (error) {
      // Upstream's directory fingerprint worker pool can reject a cold walk
      // before compilation starts. Retry only that specific transient error.
      if (attempt >= 3 || !String(error).includes('rayon thread-pool too busy or dependency loop detected')) throw error;
      console.log(`${name}: retrying upstream fingerprint pool failure (${attempt}/3)`);
    }
  }
  // A Windows Python .cmd fallback once cached only the first source filename.
  // Require every upstream unity unit in the actual generated compile plan.
  const units = (await readdir(path.join(library, 'src/fl/build'))).filter(file => file.endsWith('.cpp'));
  const commands = JSON.parse(await readFile(path.join(library, '.build/meson-wasm-quick/compile_commands.json'), 'utf8'));
  for (const unit of units) {
    if (!commands.some(command => command.file.replaceAll('\\', '/').endsWith(`/src/fl/build/${unit}`))) {
      throw new Error(`Incomplete WASM library compile plan: missing ${unit}`);
    }
  }
  const modulePath = path.join(sketch, '.build/wasm/fastled.js');
  await access(modulePath);
  await access(path.join(sketch, '.build/wasm/fastled.wasm'));
  manifest[name] = modulePath;
  await writeFile(path.join(output, 'modules.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log(`Compiled ${Object.keys(manifest).length} modules; run-corpus.mjs ${path.join(output, 'modules.json')}`);
