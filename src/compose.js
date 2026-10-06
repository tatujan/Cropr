/* Put a cropped part of the page bitmap onto a US Letter page and make the PNG. */

import { LETTER, fitOnHalfLetter } from './geometry.js';
import { maskToRgba, placeMask, toMask } from './image.js';
import { encodeBilevelPng } from './png.js';

/**
 * @param {HTMLCanvasElement} source  page bitmap at 300 DPI
 * @param {import('./geometry.js').PixelRect} rect  crop area in source pixels
 * @param {{margin?:number, blackAndWhite?:boolean}} options
 * @returns {Promise<{blob: Blob, preview: HTMLCanvasElement}>}
 *   blob: the Letter page as PNG. preview: only the label part, as it prints.
 */
export async function makeLabelPng(source, rect, { margin = 0, blackAndWhite = true } = {}) {
  const p = fitOnHalfLetter(rect.sw, rect.sh, margin);

  // Draw only the label, at its final size and turn. The rest of the page stays white.
  const label = document.createElement('canvas');
  label.width = p.dw;
  label.height = p.dh;
  const ctx = context2d(label, { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, p.dw, p.dh);
  ctx.imageSmoothingQuality = 'high';

  const { sx, sy, sw, sh } = rect;
  if (p.rotate) {
    // After the 90° turn, the source width is vertical: draw it dh wide and dw high.
    ctx.translate(p.dw / 2, p.dh / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(source, sx, sy, sw, sh, -p.dh / 2, -p.dw / 2, p.dh, p.dw);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, p.dw, p.dh);
  }

  if (!blackAndWhite) {
    return { blob: await grayscaleLetterPng(label, p), preview: label };
  }

  // getImageData can contain noise from browser fingerprinting protection.
  // The threshold removes it, and the PNG is made from the mask, not from a canvas.
  const mask = toMask(ctx.getImageData(0, 0, p.dw, p.dh).data);
  ctx.putImageData(new ImageData(maskToRgba(mask), p.dw, p.dh), 0, 0);

  const page = placeMask(mask, p.dw, p.dh, LETTER.width, LETTER.height, p.dx, p.dy);
  const png = await encodeBilevelPng(page, LETTER.width, LETTER.height);
  return { blob: new Blob([png], { type: 'image/png' }), preview: label };
}

/**
 * Letter PNG through canvas.toBlob. Browsers with fingerprinting protection can add noise.
 * @param {HTMLCanvasElement} label @param {{dx: number, dy: number}} p
 * @returns {Promise<Blob>}
 */
function grayscaleLetterPng(label, p) {
  const page = document.createElement('canvas');
  page.width = LETTER.width;
  page.height = LETTER.height;
  const ctx = context2d(page);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, page.width, page.height);
  ctx.drawImage(label, p.dx, p.dy);
  return new Promise((resolve, reject) =>
    page.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasRenderingContext2DSettings} [settings]
 */
function context2d(canvas, settings) {
  const ctx = canvas.getContext('2d', settings);
  if (!ctx) throw new Error('Canvas 2D is not available');
  return ctx;
}
