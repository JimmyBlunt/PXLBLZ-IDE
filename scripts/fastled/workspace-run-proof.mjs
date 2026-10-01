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
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.locator('.monaco-editor .view-lines').waitFor();
  console.log('Loaded isolated FastLED editor');
  assert.equal(await page.evaluate(() => crossOriginIsolated), true);
  await page.getByLabel('Official example').selectOption('Blink');
  const compileResponse = page.waitForResponse(response => response.url().endsWith('/compile'), { timeout: 660000 });
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
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.screenshot({ path: fileURLToPath(new URL('workspace-running-blink.png', output)), fullPage: true });
  await page.getByLabel('Import source file', { exact: true }).setInputFiles({
    name: 'Broken.ino', mimeType: 'text/plain', buffer: Buffer.from('#include <FastLED.h>\nvoid setup() { missing_symbol(); }\nvoid loop() {}\n'),
  });
  const failedCompile = page.waitForResponse(response => response.url().endsWith('/compile'), { timeout: 660000 });
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
    artifactId: artifact.id, fastledVersion: artifact.fastledVersion, errors,
    passed: ['real UI compile and run', 'one rendered LED', 'pause/run/reset controls', 'actual C++ diagnostic', 'discard refusal', 'full document return to non-isolated Gallery'] };
  await writeFile(new URL('workspace-run.json', output), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); }
