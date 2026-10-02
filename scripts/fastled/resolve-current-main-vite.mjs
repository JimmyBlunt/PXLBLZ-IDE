import { readFile, writeFile } from 'node:fs/promises';

const path = 'vite.config.ts';
let source = await readFile(path, 'utf8');

function insertAfter(needle, addition, label) {
  if (source.includes(addition.trim())) return;
  if (!source.includes(needle)) throw new Error(`Cannot resolve vite.config.ts: missing ${label} anchor`);
  source = source.replace(needle, needle + addition);
}

insertAfter(
  "import { readWorkerCount } from './scripts/worker-count-env.js'\n",
  "import { fastLedIsolationHeaders } from './src/engine/fastled/isolation'\n",
  'worker-count import',
);

insertAfter(
  "  '**/worktrees/**',\n",
  "  // Generated upstream C++/compiler checkout used by native/WASM parity.\n  'test/fastled/.cache/**',\n",
  'test discovery exclusions',
);

if (!source.includes("function fastLedIsolation(base: string): import('vite').Plugin")) {
  const anchor = "export default defineConfig(async ({ command, mode, isPreview }): Promise<ViteUserConfig> => {";
  if (!source.includes(anchor)) throw new Error('Cannot resolve vite.config.ts: missing defineConfig anchor');
  const plugin = `// Mirror the production asset headers on both development and built previews.
// Policy is intentionally document-scoped: Pixelblaze's existing OAuth and
// extension flows continue in their ordinary, non-isolated document.
function fastLedIsolation(base: string): import('vite').Plugin {
  const install = (server: import('vite').ViteDevServer | import('vite').PreviewServer) => {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
      for (const [name, value] of Object.entries(fastLedIsolationHeaders(pathname, base))) response.setHeader(name, value)
      next()
    })
  }
  return { name: 'fastled-document-isolation', configureServer: install, configurePreviewServer: install }
}

`;
  source = source.replace(anchor, plugin + anchor);
}

insertAfter(
  "    plugins: [\n",
  "      fastLedIsolation(base),\n",
  'plugins list',
);

if (!source.includes("**/FastLED-3.10.4/**")) {
  const anchor = "      allowedHosts: true,\n";
  if (!source.includes(anchor)) throw new Error('Cannot resolve vite.config.ts: missing server anchor');
  source = source.replace(
    anchor,
    anchor + `      // Native compiler/toolchain copies contain their own tsconfig, HTML and
      // frontend files. They are generated/test inputs, not app source, and
      // must not invalidate or reload the IDE while performance tests run.
      watch: { ignored: [
        '**/test/fastled/.cache/**',
        '**/FastLED-3.10.4/**',
        '**/fastled-cli/**',
      ] },
`,
  );
}

if (!source.includes("entries: ['index.html']")) {
  const anchor = "    optimizeDeps: {\n";
  if (!source.includes(anchor)) throw new Error('Cannot resolve vite.config.ts: missing optimizeDeps anchor');
  source = source.replace(
    anchor,
    anchor + `      // CI checks out FastLED and its CLI underneath the repository root. Keep
      // Vite's dependency crawler on the actual app entry so vendor/demo HTML
      // cannot inject unrelated dependency scans or hot reloads.
      entries: ['index.html'],
`,
  );
}

for (const required of [
  'vitestWorkerCount',
  'maxWorkers: 1',
  'fileParallelism: false',
  'fastLedIsolation(base)',
  "test/fastled/.cache/**",
  "**/FastLED-3.10.4/**",
  "**/fastled-cli/**",
  "entries: ['index.html']",
  'maxWorkers: vitestWorkerCount',
]) {
  if (!source.includes(required)) throw new Error(`Resolved vite.config.ts lost required setting: ${required}`);
}

await writeFile(path, source);
console.log('Resolved vite.config.ts with current main settings plus FastLED isolation and toolchain exclusions.');
