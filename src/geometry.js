/* Pure geometry helpers. No DOM access, so Node can test them.
 *
 * A CropSelection is { x, y, w, h } in fractions (0..1) of the page size.
 * Fractions do not change when the preview size changes, so the same
 * selection is correct for the on-screen box and for the 300 DPI bitmap.
 */

/** @typedef {{x: number, y: number, w: number, h: number}} CropSelection */

export const DPI = 300;

/**
 * Output paper sizes at 300 DPI. `area` is where the label goes: the top half
 * of a Letter sheet (so the bottom half stays free), or the whole 4×6 label.
 * @typedef {'letter' | '4x6'} PaperKey
 * @typedef {{width: number, height: number, area: {x: number, y: number, width: number, height: number}, margin: number, size: string}} Paper
 * @type {Record<PaperKey, Paper>}
 */
export const PAPERS = {
  letter: {
    width: 2550,
    height: 3300,
    area: { x: 0, y: 0, width: 2550, height: 1650 },
    margin: 60, // 0.2 in
    size: '8.5 × 11 in',
  },
  '4x6': {
    width: 1200,
    height: 1800,
    area: { x: 0, y: 0, width: 1200, height: 1800 },
    margin: 30, // 0.1 in
    size: '4 × 6 in',
  },
};

export const MIN_SELECTION = 0.02; // smallest width or height of a selection
export const DEFAULT_MANUAL_SELECTION = Object.freeze({ x: 0.1, y: 0.15, w: 0.8, h: 0.4 });

/** Pages taller than this (in inches) hold the label in the top half. */
export const HALF_PAGE_MIN_HEIGHT_IN = 9;
/** White space kept around the trimmed label content: 0.05 in. */
export const TRIM_PADDING = 15;

/**
 * The area that auto crop starts from. A Letter, A4 or Legal page holds the
 * label in its top half. A smaller page (for example a 4×6 label PDF) is the label.
 * @param {number} widthPt  page width in PDF points (1/72 in)
 * @param {number} heightPt
 * @returns {{selection: CropSelection, kind: 'top-half' | 'whole-page'}}
 */
export function autoCropArea(widthPt, heightPt) {
  if (heightPt / 72 > HALF_PAGE_MIN_HEIGHT_IN && heightPt > widthPt) {
    return { selection: { x: 0, y: 0, w: 1, h: 0.5 }, kind: 'top-half' };
  }
  return { selection: { x: 0, y: 0, w: 1, h: 1 }, kind: 'whole-page' };
}

/** @param {number} v @param {number} lo @param {number} hi */
export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * Move the selection by (dx, dy) fractions. It stays inside the page.
 * @param {CropSelection} start @param {number} dx @param {number} dy
 * @returns {CropSelection}
 */
export function moveSelection(start, dx, dy) {
  return {
    ...start,
    x: clamp(start.x + dx, 0, 1 - start.w),
    y: clamp(start.y + dy, 0, 1 - start.h),
  };
}

/**
 * Move the edges named by `handle` ("n", "se", "w", ...) by (dx, dy) fractions.
 * The opposite edges do not move. The size never goes below `min`.
 * @param {CropSelection} start @param {string} handle @param {number} dx @param {number} dy
 * @returns {CropSelection}
 */
export function resizeSelection(start, handle, dx, dy, min = MIN_SELECTION) {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;

  if (handle.includes('w')) left = clamp(left + dx, 0, right - min);
  if (handle.includes('e')) right = clamp(right + dx, left + min, 1);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - min);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + min, 1);

  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** @typedef {{sx: number, sy: number, sw: number, sh: number}} PixelRect */

/**
 * Convert a selection to an integer pixel rectangle in a width × height bitmap.
 * @param {CropSelection} sel @param {number} width @param {number} height
 * @returns {PixelRect}
 */
export function selectionToPixels(sel, width, height) {
  const sx = clamp(Math.round(sel.x * width), 0, width - 1);
  const sy = clamp(Math.round(sel.y * height), 0, height - 1);
  const ex = clamp(Math.round((sel.x + sel.w) * width), sx + 1, width);
  const ey = clamp(Math.round((sel.y + sel.h) * height), sy + 1, height);
  return { sx, sy, sw: ex - sx, sh: ey - sy };
}

/**
 * Make a pixel rectangle smaller to the content bounds (from `contentBounds`,
 * relative to the rectangle), with `pad` pixels of white space kept around it.
 * With no content, the rectangle does not change.
 * @param {PixelRect} rect
 * @param {{x0: number, y0: number, x1: number, y1: number} | null} bounds
 * @returns {PixelRect}
 */
export function trimRect(rect, bounds, pad = TRIM_PADDING) {
  if (!bounds) return rect;
  const x0 = Math.max(0, bounds.x0 - pad);
  const y0 = Math.max(0, bounds.y0 - pad);
  const x1 = Math.min(rect.sw, bounds.x1 + pad);
  const y1 = Math.min(rect.sh, bounds.y1 + pad);
  return { sx: rect.sx + x0, sy: rect.sy + y0, sw: x1 - x0, sh: y1 - y0 };
}

/** @typedef {0 | 90 | 180 | 270} Rotation */

/**
 * Find where an sw × sh label goes on the paper. The label turns 90° when that
 * makes it fit larger; `turn` (the user's rotation) adds to that. The label
 * never becomes larger than its true size (scale ≤ 1). `dw` × `dh` is the size
 * on the paper after the rotation. All values are integers, so no edge falls
 * between pixels.
 * @param {number} sw @param {number} sh
 * @param {PaperKey} paperKey
 * @param {Rotation} [turn]
 * @returns {{rotation: Rotation, scale: number, dw: number, dh: number, dx: number, dy: number}}
 */
export function fitOnPaper(sw, sh, paperKey, turn = 0) {
  const { area, margin } = PAPERS[paperKey];
  const maxW = area.width - 2 * margin;
  const maxH = area.height - 2 * margin;
  /** @param {number} w @param {number} h */
  const fit = (w, h) => Math.min(1, maxW / w, maxH / h);

  const autoTurn = fit(sh, sw) > fit(sw, sh) ? 90 : 0;
  const rotation = /** @type {Rotation} */ ((autoTurn + turn) % 360);
  const sideways = rotation % 180 !== 0;
  const w = sideways ? sh : sw;
  const h = sideways ? sw : sh;
  const scale = fit(w, h);
  const dw = Math.round(w * scale);
  const dh = Math.round(h * scale);
  return {
    rotation,
    scale,
    dw,
    dh,
    dx: area.x + Math.round((area.width - dw) / 2),
    dy: area.y + Math.round((area.height - dh) / 2),
  };
}

export const KEY_STEP = 0.01; // 1 % of the page for each arrow key press
export const FINE_KEY_STEP = 0.002; // with Alt

const ARROWS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Keyboard control: an arrow key moves the selection. With `resize`, it moves
 * the right or bottom edge. Returns null for keys that are not arrow keys.
 * @param {CropSelection} sel
 * @param {string} key  KeyboardEvent.key
 * @returns {CropSelection | null}
 */
export function selectionFromKey(sel, key, { resize = false, fine = false } = {}) {
  const dir = ARROWS[/** @type {keyof typeof ARROWS} */ (key)];
  if (!dir) return null;
  const step = fine ? FINE_KEY_STEP : KEY_STEP;
  const dx = dir[0] * step;
  const dy = dir[1] * step;
  return resize ? resizeSelection(sel, 'se', dx, dy) : moveSelection(sel, dx, dy);
}
