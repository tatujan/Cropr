import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  MIN_SELECTION,
  PAPERS,
  autoCropArea,
  fitOnPaper,
  trimRect,
  moveSelection,
  KEY_STEP,
  resizeSelection,
  selectionFromKey,
  selectionToPixels,
} from '../../src/geometry.js';

/**
 * @param {Record<string, number> | null} actual
 * @param {Record<string, number>} expected
 */
const near = (actual, expected) => {
  assert.ok(actual, 'expected a selection');
  for (const k of Object.keys(expected)) {
    assert.ok(Math.abs(actual[k] - expected[k]) < 1e-9, `${k}: ${actual[k]} != ${expected[k]}`);
  }
};

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
  assert.deepEqual(selectionToPixels({ x: 0, y: 0, w: 1, h: 0.5 }, 2550, 3300), {
    sx: 0,
    sy: 0,
    sw: 2550,
    sh: 1650,
  });
  assert.deepEqual(selectionToPixels({ x: 0.1, y: 0.2, w: 0.5, h: 0.25 }, 1000, 2000), {
    sx: 100,
    sy: 400,
    sw: 500,
    sh: 500,
  });
});

test('selectionToPixels always gives at least one pixel inside the bitmap', () => {
  assert.deepEqual(selectionToPixels({ x: 1, y: 1, w: 0, h: 0 }, 100, 100), {
    sx: 99,
    sy: 99,
    sw: 1,
    sh: 1,
  });
});

test('autoCropArea takes the top half of Letter, A4 and Legal pages', () => {
  for (const [w, h] of [
    [612, 792],
    [595, 842],
    [612, 1008],
  ]) {
    assert.deepEqual(autoCropArea(w, h), {
      selection: { x: 0, y: 0, w: 1, h: 0.5 },
      kind: 'top-half',
    });
  }
});

test('autoCropArea takes the whole page of a label-size or landscape page', () => {
  assert.equal(autoCropArea(288, 432).kind, 'whole-page'); // 4 × 6 in
  assert.equal(autoCropArea(792, 612).kind, 'whole-page'); // Letter, landscape
});

test('trimRect keeps padding around the content and stays inside the rectangle', () => {
  const rect = { sx: 100, sy: 50, sw: 1000, sh: 800 };
  assert.deepEqual(trimRect(rect, { x0: 200, y0: 100, x1: 600, y1: 500 }, 15), {
    sx: 285,
    sy: 135,
    sw: 430,
    sh: 430,
  });
  assert.deepEqual(trimRect(rect, { x0: 5, y0: 0, x1: 1000, y1: 790 }, 15), rect);
  assert.equal(trimRect(rect, null), rect);
});

test('fitOnPaper puts a label that fits at true size, centered in the area', () => {
  const p = fitOnPaper(1000, 600, 'letter');
  assert.deepEqual(p, { rotation: 0, scale: 1, dw: 1000, dh: 600, dx: 775, dy: 525 });
});

test('fitOnPaper turns a label when that makes it larger', () => {
  // A 6 × 4 in label (landscape) on 4 × 6 paper turns to portrait
  const p = fitOnPaper(1800, 1200, '4x6');
  assert.equal(p.rotation, 90);
  assert.ok(p.dh > p.dw);
  assert.ok(p.scale > 0.9);
  // A tall label in the wide top half of Letter turns to landscape
  assert.equal(fitOnPaper(1200, 1800, 'letter').rotation, 90);
});

test('fitOnPaper adds the user rotation and keeps the label inside the margins', () => {
  for (const turn of /** @type {const} */ ([0, 90, 180, 270])) {
    for (const paper of /** @type {const} */ (['letter', '4x6'])) {
      const p = fitOnPaper(2550, 1650, paper, turn);
      const { area, margin } = PAPERS[paper];
      assert.ok(p.dx >= area.x + margin && p.dx + p.dw <= area.x + area.width - margin);
      assert.ok(p.dy >= area.y + margin && p.dy + p.dh <= area.y + area.height - margin);
      for (const v of [p.dx, p.dy, p.dw, p.dh]) assert.ok(Number.isInteger(v));
    }
  }
  assert.equal(fitOnPaper(1000, 600, 'letter', 180).rotation, 180);
  assert.equal(fitOnPaper(1800, 1200, '4x6', 270).rotation, 0); // auto 90 + 270
});

test('selectionFromKey moves the selection with arrow keys', () => {
  const start = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
  near(selectionFromKey(start, 'ArrowRight'), { x: 0.2 + KEY_STEP, y: 0.2, w: 0.4, h: 0.4 });
  near(selectionFromKey(start, 'ArrowUp'), { x: 0.2, y: 0.2 - KEY_STEP });
  near(selectionFromKey({ ...start, x: 0 }, 'ArrowLeft'), { x: 0 });
});

test('selectionFromKey with resize moves the right and bottom edges', () => {
  const start = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
  near(selectionFromKey(start, 'ArrowRight', { resize: true }), { x: 0.2, w: 0.4 + KEY_STEP });
  near(selectionFromKey(start, 'ArrowUp', { resize: true }), { y: 0.2, h: 0.4 - KEY_STEP });
});

test('selectionFromKey ignores keys that are not arrow keys', () => {
  assert.equal(selectionFromKey({ x: 0, y: 0, w: 1, h: 1 }, 'a'), null);
});
