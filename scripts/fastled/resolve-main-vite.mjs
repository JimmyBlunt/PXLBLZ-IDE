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

if (!source.includes("watch: { ignored: ['**/test/fastled/.cache/**'] }")) {
  const anchor = "      allowedHosts: true,\n";
  if (!source.includes(anchor)) throw new Error('Cannot resolve vite.config.ts: missing server anchor');
  source = source.replace(
    anchor,
    anchor + "      // Native FastLED compiler outputs are generated artifacts and must not invalidate Vite.\n      watch: { ignored: ['**/test/fastled/.cache/**'] },\n",
  );
}

for (const required of [
  'vitestWorkerCount',
  'maxWorkers: 1',
  'fileParallelism: false',
  'fastLedIsolation(base)',
  "test/fastled/.cache/**",
  "watch: { ignored: ['**/test/fastled/.cache/**'] }",
]) {
  if (!source.includes(required)) throw new Error(`Resolved vite.config.ts lost required setting: ${required}`);
}

await writeFile(path, source);
console.log('Resolved vite.config.ts by retaining current main settings and layering FastLED isolation/cache exclusions.');
