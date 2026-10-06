import { test } from 'vitest';
import assert from 'node:assert/strict';
import { BW_THRESHOLD, contentBounds, maskToRgba, placeMask, toMask } from '../../src/image.js';

/** @param {...number} grays */
const rgba = (...grays) => Uint8ClampedArray.from(grays.flatMap((g) => [g, g, g, 255]));

test('light gray haze and read-back noise become white', () => {
  assert.deepEqual([...toMask(rgba(255, 254, 250, 235, BW_THRESHOLD))], [0, 0, 0, 0, 0]);
});

test('dark and mid-gray pixels become black', () => {
  assert.deepEqual([...toMask(rgba(0, 5, 20, 128, BW_THRESHOLD - 1))], [1, 1, 1, 1, 1]);
});

test('maskToRgba gives opaque pure black and white', () => {
  assert.deepEqual([...maskToRgba(Uint8Array.of(1, 0))], [0, 0, 0, 255, 255, 255, 255, 255]);
});

test('placeMask copies the label into a white page', () => {
  const page = placeMask(Uint8Array.of(1, 1, 1, 0), 2, 2, 4, 3, 1, 1);
  assert.deepEqual([...page], [0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0]);
});

test('contentBounds finds the box around dark pixels and ignores light haze', () => {
  // 4 × 3 image: haze (235) everywhere, dark pixels at (1,0) and (2,1)
  const grays = Array(12).fill(235);
  grays[1] = 0;
  grays[4 + 2] = 100;
  assert.deepEqual(contentBounds(rgba(...grays), 4, 3), { x0: 1, y0: 0, x1: 3, y1: 2 });
  assert.equal(contentBounds(rgba(...Array(12).fill(250)), 4, 3), null);
});
