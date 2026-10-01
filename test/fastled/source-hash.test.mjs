import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hashTree } from './source-hash.mjs';

test('header changes invalidate parity builds even when timestamps are preserved', async () => {
  const prefix = path.join(os.tmpdir(), 'pxlblz-fastled-hash-');
  const directory = await mkdtemp(prefix);
  try {
    await mkdir(path.join(directory, 'nested'));
    const header = path.join(directory, 'nested', 'colour.h');
    await writeFile(header, '#define SCALE 255\n');
    const first = await hashTree(directory);
    await writeFile(header, '#define SCALE 254\n');
    await utimes(header, 1, 1);
    const changed = await hashTree(directory);
    assert.notEqual(first.sha256, changed.sha256);
    await writeFile(header, '#define SCALE 255\n');
    assert.equal((await hashTree(directory)).sha256, first.sha256);
    assert.deepEqual(first.files.map(file => file.path), ['nested/colour.h']);
  } finally {
    // Only remove the unique directory created by this test, inside temp.
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(prefix)));
    await rm(resolved, { recursive: true });
  }
});
