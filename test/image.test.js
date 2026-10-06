import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BW_THRESHOLD, maskToRgba, placeMask, toMask } from '../src/image.js';

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
  assert.deepEqual([...page], [
    0, 0, 0, 0,
    0, 1, 1, 0,
    0, 1, 0, 0,
  ]);
});
