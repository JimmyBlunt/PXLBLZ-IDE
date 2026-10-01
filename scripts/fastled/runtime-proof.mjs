// Exercise the actual browser worker with an already compiled official Blink.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { chromium } from 'playwright';

if (!process.argv[2]) throw new Error('Usage: node scripts/fastled/runtime-proof.mjs <Blink-artifact.json> [IDE URL]');
const artifact = JSON.parse(await readFile(process.argv[2], 'utf8'));
const rapidShow = process.argv.includes('--rapid-show');
const url = process.argv.slice(3).find(value => !value.startsWith('--')) ?? 'http://127.0.0.1:5184/PXLBLZ-IDE/fastled';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
  const result = await page.evaluate(async ({ artifact, rapidShow }) => {
    if (!crossOriginIsolated) throw new Error('FastLED document is not cross-origin isolated');
    const { createFastLedRuntime } = await import('/PXLBLZ-IDE/src/engine/fastled/index.ts');
    const frames = [];
    const failures = [];
    let count = 0;
    const waitFor = async predicate => {
      const deadline = performance.now() + 12000;
      while (!predicate()) {
        if (failures.length) throw new Error(failures.join('\n'));
        if (performance.now() > deadline) throw new Error('Timed out waiting for real FastLED frames');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    };
    const runtime = await createFastLedRuntime({
      artifact,
      onFrame(frame) { count++; frames.push(Array.from(frame)); },
      onError(message) { failures.push(message); },
    });
    try {
      runtime.start();
      const start = performance.now();
      if (rapidShow) await waitFor(() => frames.some(frame => frame[2] === 255));
      else await waitFor(() => frames.filter(frame => frame[0] === 255).length >= 3);
      const firstTargetLatencyMs = performance.now() - start;
      if (rapidShow && firstTargetLatencyMs >= 900) throw new Error('Final blue show was not visible during the blocking delay');
      runtime.pause();
      const pausedCount = count;
      await new Promise(resolve => setTimeout(resolve, 800));
      if (count !== pausedCount) throw new Error('Paused worker delivered a frame');
      const beforeReset = count;
      runtime.reset();
      runtime.start();
      await waitFor(() => frames.slice(beforeReset).some(frame => frame[rapidShow ? 2 : 0] === 255));
      runtime.dispose();
      const disposedCount = count;
      await new Promise(resolve => setTimeout(resolve, 800));
      if (count !== disposedCount) throw new Error('Disposed worker delivered a frame');
      return { isolated: crossOriginIsolated, frames, failures, pausedCount, disposedCount, firstTargetLatencyMs };
    } finally { runtime.dispose(); }
  }, { artifact, rapidShow });
  assert.deepEqual(errors, []);
  assert.deepEqual(result.failures, []);
  assert.ok(result.frames.every(frame => frame.length === 3));
  const colors = result.frames.map(frame => frame.join(','));
  if (rapidShow) assert.ok(colors.includes('0,0,255'), 'Rapid shows must retain final blue while C++ blocks');
  else {
    assert.ok(colors.includes('255,0,0'), 'Blink must produce red');
    assert.ok(colors.includes('0,0,0'), 'Blink must produce black between red shows');
    const firstRed = colors.indexOf('255,0,0');
    const followingBlack = colors.indexOf('0,0,0', firstRed + 1);
    assert.ok(followingBlack > firstRed && colors.indexOf('255,0,0', followingBlack + 1) > followingBlack,
      'Intermediate shows inside one blocking loop must remain observable');
  }
  const { diagnostics: _diagnostics, ...artifactIdentity } = artifact;
  const evidence = { capturedAt: new Date().toISOString(), artifact: artifactIdentity, url, ...result, errors,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(),
    passed: [rapidShow ? 'rapid shows retain final blue during blocking delay' : 'real WASM Blink intermediate RGB frames', 'pause delivery', 'reset', 'dispose'],
    excluded: ['full native/WASM corpus parity', 'physical LED output'] };
  await writeFile(new URL(`../../docs/fastled/evidence/runtime-${rapidShow ? 'rapid-show' : 'blink'}.json`, import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); }
