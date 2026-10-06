/* Pure pixel helpers. No DOM access, so Node can test them.
 *
 * A mask is a Uint8Array with one value per pixel: 1 = black, 0 = white.
 */

/*
 * Pixels darker than this become black. All other pixels become white.
 * A value above the midpoint (128) keeps mid-gray text, and removes the light
 * gray haze, anti-aliasing and canvas read-back noise that printers show as faint marks.
 */
export const BW_THRESHOLD = 160;

/**
 * Make a mask from RGBA pixel data.
 * @param {ArrayLike<number>} data
 * @returns {Uint8Array}
 */
export function toMask(data, threshold = BW_THRESHOLD) {
  const limit = threshold * 1000;
  const mask = new Uint8Array(data.length / 4);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const luma = data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114; // Rec. 601 × 1000
    mask[p] = luma < limit ? 1 : 0;
  }
  return mask;
}

/**
 * Make opaque black-and-white RGBA pixel data from a mask (for the on-screen preview).
 * @param {Uint8Array} mask
 * @returns {Uint8ClampedArray<ArrayBuffer>}
 */
export function maskToRgba(mask) {
  const data = new Uint8ClampedArray(mask.length * 4);
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    const v = mask[p] ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  return data;
}

/**
 * Copy a w × h mask into a white pageWidth × pageHeight mask at (dx, dy).
 * @param {Uint8Array} mask @param {number} w @param {number} h
 * @param {number} pageWidth @param {number} pageHeight @param {number} dx @param {number} dy
 * @returns {Uint8Array}
 */
export function placeMask(mask, w, h, pageWidth, pageHeight, dx, dy) {
  const page = new Uint8Array(pageWidth * pageHeight);
  for (let y = 0; y < h; y++) {
    page.set(mask.subarray(y * w, (y + 1) * w), (dy + y) * pageWidth + dx);
  }
  return page;
}
