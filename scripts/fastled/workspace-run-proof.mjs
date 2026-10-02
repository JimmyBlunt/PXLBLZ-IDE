// End-to-end product controls, using the real loopback C++ compiler.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:5184/PXLBLZ-IDE/fastled';
const output = new URL('../../docs/fastled/evidence/', import.meta.url);
const browser = await chromium.launch({ headless: true });
const states = [];
const errors = [];
const consoleMessages = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  page.setDefaultTimeout(120000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (consoleMessages.length < 100) consoleMessages.push({ type: message.type(), text: message.text() }); });
  await page.exposeFunction('recordFastLedProofState', state => {
    states.push(state);
    console.log(`UI state ${JSON.stringify(state)}`);
  });
  await page.addInitScript(() => {
    let previous = '';
    const observe = () => {
      const state = {
        status: document.querySelector('.fastled-diagnostics strong')?.textContent ?? '',
        diagnostics: document.querySelector('.fastled-diagnostics pre')?.textContent?.slice(-1000) ?? '',
        filename: document.querySelector('.fastled-code .fastled-pane-heading')?.textContent ?? '',
        leds: document.querySelector('.fastled-preview .fastled-pane-heading')?.textContent ?? '',
      };
      const serialized = JSON.stringify(state);
      if (serialized !== previous && state.status) {
        previous = serialized;
        void window.recordFastLedProofState({ ...state, at: performance.now() });
      }
    };
    new MutationObserver(observe).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.locator('.monaco-editor .view-lines').waitFor();
  console.log('Loaded isolated FastLED editor');
  assert.equal(await page.evaluate(() => crossOriginIsolated), true);
  await page.getByLabel('Official example').selectOption('Blink');
  const compileResponse = page.waitForResponse(response => response.url().endsWith('/compile') && response.request().method() === 'POST', { timeout: 660000 });
  await page.getByRole('button', { name: 'Compile & run', exact: true }).click();
  const response = await compileResponse;
  const artifact = await response.json();
  console.log(`Real Blink compile returned ${response.status()}`);
  assert.equal(response.status(), 200, artifact.diagnostics ?? artifact.error);
  await page.locator('.fastled-diagnostics strong').filter({ hasText: /^(Running|Error)$/ }).waitFor();
  assert.equal(await page.locator('.fastled-diagnostics strong').textContent(), 'Running', await page.locator('.fastled-diagnostics').textContent());
  await page.getByText('1 LEDs', { exact: true }).waitFor();
  console.log('Blink rendered one LED');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  assert.equal(await page.locator('.fastled-diagnostics strong').textContent(), 'Paused');
  console.log('Capturing paused rendered preview');
  await page.screenshot({ path: fileURLToPath(new URL('workspace-running-blink.png', output)), fullPage: true, timeout: 30000 });
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  console.log('Importing invalid C++');
  await page.getByLabel('Import source file', { exact: true }).setInputFiles({
    name: 'Broken.ino', mimeType: 'text/plain', buffer: Buffer.from('#include <FastLED.h>\nvoid setup() { missing_symbol(); }\nvoid loop() {}\n'),
  });
  await page.locator('.fastled-code .fastled-pane-heading').filter({ hasText: 'Broken.ino' }).waitFor();
  const failedCompile = page.waitForResponse(response => response.url().endsWith('/compile') && response.request().method() === 'POST', { timeout: 660000 });
  console.log('Compiling invalid C++');
  await page.getByRole('button', { name: 'Compile & run', exact: true }).click();
  assert.equal((await failedCompile).status(), 422);
  console.log('Invalid C++ returned compiler diagnostics');
  await page.locator('.fastled-diagnostics strong').filter({ hasText: /^Error$/ }).waitFor();
  assert.match(await page.locator('.fastled-diagnostics pre').textContent(), /missing_symbol/);
  // Importing a file already on disk is clean; editing it must trigger the
  // native beforeunload guard on a full document navigation.
  await page.locator('.monaco-editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n// unsaved browser proof');
  await page.getByText(/Not downloaded/).waitFor();
  const dismissed = page.waitForEvent('dialog').then(dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Back to PXLBLZ' }).click();
  await dismissed;
  console.log('Unsaved navigation refused');
  assert.equal(page.url(), url);
  const accepted = page.waitForEvent('dialog').then(dialog => dialog.accept());
  await page.getByRole('button', { name: 'Back to PXLBLZ' }).click();
  await accepted;
  console.log('Unsaved navigation accepted');
  await page.waitForURL(/\/gallery(?:\?|$)/);
  assert.equal(await page.evaluate(() => crossOriginIsolated), false);
  assert.deepEqual(errors, []);
  const evidence = { capturedAt: new Date().toISOString(), url,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(),
    artifactId: artifact.id, fastledVersion: artifact.fastledVersion, errors, states,
    passed: ['real UI compile and run', 'one rendered LED', 'pause/run/reset controls', 'actual C++ diagnostic', 'discard refusal', 'full document return to non-isolated Gallery'] };
  await writeFile(new URL('workspace-run.json', output), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} catch (error) {
  const snapshot = page && !page.isClosed() ? await page.locator('body').innerText().catch(() => '') : '';
  const evidence = { capturedAt: new Date().toISOString(), url: page?.url(), error: String(error), states, errors, consoleMessages, snapshot };
  await writeFile(new URL('workspace-run-failure.json', output), JSON.stringify(evidence, null, 2) + '\n');
  if (page && !page.isClosed()) await page.screenshot({ path: fileURLToPath(new URL('workspace-run-failure.png', output)), fullPage: true, timeout: 30000 }).catch(() => {});
  console.error(JSON.stringify(evidence));
  throw error;
} finally { await browser.close(); }
