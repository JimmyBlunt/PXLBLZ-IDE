// Real browser UI proof; the compiled-demo parity suite is a separate gate.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const output = new URL('../../docs/fastled/evidence/', import.meta.url);
const url = process.argv[2] ?? 'http://127.0.0.1:5184/PXLBLZ-IDE/fastled';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByRole('heading', { name: 'FastLED', exact: true }).waitFor({ timeout: 180000 });
  await page.locator('.monaco-editor .view-lines').waitFor({ timeout: 180000 });
  await page.getByLabel('Official example').selectOption('NoisePlusPalette');
  await page.getByLabel('Project file', { exact: true }).selectOption('NoisePlusPalette.h');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project', exact: true }).click();
  const download = await downloadPromise;
  const downloaded = JSON.parse(await readFile(await download.path(), 'utf8'));
  const originalMain = await readFile(new URL('../../src/engine/fastled/examples/NoisePlusPalette.ino', import.meta.url), 'utf8');
  const originalHeader = await readFile(new URL('../../src/engine/fastled/examples/NoisePlusPalette.h', import.meta.url), 'utf8');
  assert.equal(downloaded.source, originalMain);
  assert.equal(downloaded.files['NoisePlusPalette.h'], originalHeader);
  await page.locator('.monaco-editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('// browser proof: edited support file');
  await page.getByText(/Not downloaded/).waitFor();
  const dismissal = page.waitForEvent('dialog').then((dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Back to PXLBLZ' }).click();
  await dismissal;
  assert.equal(page.url(), url);
  const editedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project', exact: true }).click();
  const edited = JSON.parse(await readFile(await (await editedDownload).path(), 'utf8'));
  assert.ok(edited.files['NoisePlusPalette.h'].includes('// browser proof: edited support file'));
  await page.getByLabel('Official example').selectOption('Blink');
  await page.getByLabel('Import project file').setInputFiles({ name: 'restored.fastled.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(edited)) });
  await page.getByLabel('Project file', { exact: true }).selectOption('NoisePlusPalette.h');
  const restoredDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project', exact: true }).click();
  assert.deepEqual(JSON.parse(await readFile(await (await restoredDownload).path(), 'utf8')), edited);
  await page.screenshot({ path: fileURLToPath(new URL('workspace-desktop.png', output)), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: fileURLToPath(new URL('workspace-narrow.png', output)), fullPage: true });
  await page.locator('.fastled-workspace').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.screenshot({ path: fileURLToPath(new URL('workspace-narrow-bottom.png', output)), fullPage: true });
  const geometry = await page.evaluate(() => {
    const footer = document.querySelector('.fastled-workspace footer').getBoundingClientRect();
    const preview = document.querySelector('.fastled-preview').getBoundingClientRect();
    return { horizontalOverflow: document.documentElement.scrollWidth > innerWidth, footerOverlapsPreview: footer.top < preview.bottom - 1 };
  });
  assert.equal(geometry.horizontalOverflow, false);
  assert.equal(geometry.footerOverlapsPreview, false);
  assert.deepEqual(errors, []);
  const result = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(),
    capturedAt: new Date().toISOString(), url, errors, geometry,
    passed: ['original multi-file demo export', 'support-file editing', 'discard refusal', 'edited project import/export round trip', 'desktop and narrow layout'],
    excluded: ['C++ compilation', 'native/WASM parity', 'physical LED output'],
  };
  await writeFile(new URL('workspace-smoke.json', output), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
