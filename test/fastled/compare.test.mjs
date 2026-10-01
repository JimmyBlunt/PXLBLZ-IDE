import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrames, compareFrames } from './compare.mjs';

const frame = { timeUs: 16667, strip: 0, brightness: 96, rgb: [255, 0, 0] };
test('parity evidence rejects missing executions and dropped intermediate show calls', () => {
  assert.throws(() => compareFrames([], []), /at least one/);
  assert.throws(() => compareFrames([frame, frame], [frame]), /Frame count/);
});
test('parity evidence reports the exact differing pixel channel', () => {
  assert.throws(() => compareFrames([frame], [{ ...frame, rgb: [254, 0, 0] }]), /pixel 0, R/);
  assert.throws(() => compareFrames([frame], [{ ...frame, timeUs: 1 }]), /timeUs/);
});
test('console logs cannot become frames and malformed RGB cannot pass', () => {
  assert.deepEqual(parseFrames(`diagnostic\nPXLFRAME ${JSON.stringify(frame)}\n`), [frame]);
  assert.throws(() => parseFrames(`PXLFRAME ${JSON.stringify({ ...frame, rgb: [256, 0, 0] })}`), /Malformed/);
  assert.deepEqual(compareFrames([frame], [frame]), { frames: 1, comparedBytes: 3, exact: true });
});
