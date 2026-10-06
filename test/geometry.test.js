import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LETTER,
  MIN_SELECTION,
  fitOnHalfLetter,
  moveSelection,
  resizeSelection,
  selectionToPixels,
} from '../src/geometry.js';

const near = (actual, expected) =>
  Object.keys(expected).forEach((k) => assert.ok(Math.abs(actual[k] - expected[k]) < 1e-9, `${k}: ${actual[k]} != ${expected[k]}`));

test('moveSelection keeps the selection inside the page', () => {
  const start = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
  near(moveSelection(start, 0.2, 0.1), { x: 0.3, y: 0.2, w: 0.5, h: 0.5 });
  near(moveSelection(start, -1, -1), { x: 0, y: 0 });
  near(moveSelection(start, 1, 1), { x: 0.5, y: 0.5 });
});

test('resizeSelection moves only the named edges', () => {
  const start = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
  near(resizeSelection(start, 'se', 0.1, 0.1), { x: 0.2, y: 0.2, w: 0.5, h: 0.5 });
  near(resizeSelection(start, 'nw', -0.1, -0.1), { x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
  near(resizeSelection(start, 'n', 0.5, 0.1), { x: 0.2, y: 0.3, w: 0.4, h: 0.3 });
  near(resizeSelection(start, 'e', 0, 0.3), { x: 0.2, y: 0.2, w: 0.5 - 0.1, h: 0.4 });
});

test('resizeSelection keeps a minimum size and stays inside the page', () => {
  const start = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
  const small = resizeSelection(start, 'w', 1, 0);
  near(small, { x: 0.6 - MIN_SELECTION, w: MIN_SELECTION });
  const big = resizeSelection(start, 'se', 5, 5);
  near(big, { w: 0.8, h: 0.8 });
  const neg = resizeSelection(start, 'nw', -5, -5);
  near(neg, { x: 0, y: 0, w: 0.6, h: 0.6 });
});

test('selectionToPixels maps fractions to the bitmap without a shift', () => {
  assert.deepEqual(selectionToPixels({ x: 0, y: 0, w: 1, h: 0.5 }, 2550, 3300), { sx: 0, sy: 0, sw: 2550, sh: 1650 });
  assert.deepEqual(selectionToPixels({ x: 0.1, y: 0.2, w: 0.5, h: 0.25 }, 1000, 2000), { sx: 100, sy: 400, sw: 500, sh: 500 });
});

test('selectionToPixels always gives at least one pixel inside the bitmap', () => {
  assert.deepEqual(selectionToPixels({ x: 1, y: 1, w: 0, h: 0 }, 100, 100), { sx: 99, sy: 99, sw: 1, sh: 1 });
});

test('fitOnHalfLetter puts the top half of a Letter page 1:1', () => {
  assert.deepEqual(fitOnHalfLetter(LETTER.width, LETTER.height / 2), { rotate: false, dw: 2550, dh: 1650, dx: 0, dy: 0 });
});

test('fitOnHalfLetter turns a portrait label and keeps it in the top half', () => {
  const p = fitOnHalfLetter(1200, 1800, 60); // 4 × 6 in label at 300 DPI
  assert.equal(p.rotate, true);
  assert.ok(p.dw > p.dh);
  assert.ok(p.dy >= 60 && p.dy + p.dh <= LETTER.height / 2 - 60);
  assert.ok(p.dx >= 60 && p.dx + p.dw <= LETTER.width - 60);
  assert.ok(Math.abs(p.dw / p.dh - 1800 / 1200) < 0.01);
});

test('fitOnHalfLetter gives integer positions', () => {
  const p = fitOnHalfLetter(777, 333, 60);
  for (const v of [p.dx, p.dy, p.dw, p.dh]) assert.ok(Number.isInteger(v));
});
