/* Pure geometry helpers. No DOM access, so Node can test them.
 *
 * A Selection is { x, y, w, h } in fractions (0..1) of the page size.
 * Fractions do not change when the preview size changes, so the same
 * Selection is correct for the on-screen box and for the 300 DPI bitmap.
 */

export const LETTER = { width: 2550, height: 3300 }; // 8.5 × 11 in at 300 DPI

export const MIN_SELECTION = 0.02;   // smallest width or height of a selection
export const PORTRAIT_RATIO = 1.2;   // taller than wide by this ratio → turn 90°

export const AUTO_SELECTION = Object.freeze({ x: 0, y: 0, w: 1, h: 0.5 });
export const DEFAULT_MANUAL_SELECTION = Object.freeze({ x: 0.1, y: 0.15, w: 0.8, h: 0.4 });

export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** Move the selection by (dx, dy) fractions. It stays inside the page. */
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

/** Convert a selection to an integer pixel rectangle in a width × height bitmap. */
export function selectionToPixels(sel, width, height) {
  const sx = clamp(Math.round(sel.x * width), 0, width - 1);
  const sy = clamp(Math.round(sel.y * height), 0, height - 1);
  const ex = clamp(Math.round((sel.x + sel.w) * width), sx + 1, width);
  const ey = clamp(Math.round((sel.y + sel.h) * height), sy + 1, height);
  return { sx, sy, sw: ex - sx, sh: ey - sy };
}

/**
 * Find where an sw × sh label goes on the top half of a Letter page.
 * A portrait label turns 90° clockwise. `dw` × `dh` is the size on the page
 * after the turn. All output values are integers, so no edge falls between pixels.
 */
export function fitOnHalfLetter(sw, sh, margin = 0) {
  const rotate = sh > sw * PORTRAIT_RATIO;
  const [w, h] = rotate ? [sh, sw] : [sw, sh];
  const maxW = LETTER.width - 2 * margin;
  const maxH = LETTER.height / 2 - 2 * margin;
  const scale = Math.min(maxW / w, maxH / h);
  const dw = Math.round(w * scale);
  const dh = Math.round(h * scale);
  return {
    rotate,
    dw,
    dh,
    dx: Math.round((LETTER.width - dw) / 2),
    dy: Math.round(margin + (maxH - dh) / 2),
  };
}
