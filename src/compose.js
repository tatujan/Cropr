/* Crop a part of the page bitmap, put it on the output paper, and make the PNG. */

import { PAPERS, fitOnPaper, selectionToPixels, trimRect } from './geometry.js';
import { contentBounds, maskToRgba, placeMask, toMask } from './image.js';
import { encodeBilevelPng } from './png.js';

/** @typedef {import('./geometry.js').PixelRect} PixelRect */
/** @typedef {import('./geometry.js').PaperKey} PaperKey */
/** @typedef {import('./geometry.js').Rotation} Rotation */
/** @typedef {ReturnType<typeof fitOnPaper>} Placement */

/**
 * Auto crop: the start area (see autoCropArea), made smaller to the label content.
 * @param {HTMLCanvasElement} source  page bitmap at 300 DPI
 * @param {import('./geometry.js').CropSelection} area
 * @returns {PixelRect}
 */
export function autoCropRect(source, area) {
  const rect = selectionToPixels(area, source.width, source.height);
  const ctx = context2d(source, { willReadFrequently: true });
  const { data } = ctx.getImageData(rect.sx, rect.sy, rect.sw, rect.sh);
  return trimRect(rect, contentBounds(data, rect.sw, rect.sh));
}

/**
 * @param {HTMLCanvasElement} source  page bitmap at 300 DPI
 * @param {PixelRect} rect  crop area in source pixels
 * @param {{paper?: PaperKey, turn?: Rotation, blackAndWhite?: boolean}} options
 * @returns {Promise<{blob: Blob, label: HTMLCanvasElement, placement: Placement}>}
 *   blob: the full paper page as PNG. label: only the label, as it prints.
 */
export async function makeLabelPng(
  source,
  rect,
  { paper = 'letter', turn = 0, blackAndWhite = true } = {},
) {
  const page = PAPERS[paper];
  const p = fitOnPaper(rect.sw, rect.sh, paper, turn);

  // Draw only the label, at its final size and rotation. The rest of the paper stays white.
  const label = document.createElement('canvas');
  label.width = p.dw;
  label.height = p.dh;
  const ctx = context2d(label, { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, p.dw, p.dh);
  ctx.imageSmoothingQuality = 'high';

  // Unrotated size of the label on the paper
  const sideways = p.rotation % 180 !== 0;
  const w = sideways ? p.dh : p.dw;
  const h = sideways ? p.dw : p.dh;
  ctx.translate(p.dw / 2, p.dh / 2);
  ctx.rotate((p.rotation * Math.PI) / 180);
  ctx.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, -w / 2, -h / 2, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (!blackAndWhite) {
    return { blob: await grayscalePng(label, p, page), label, placement: p };
  }

  // getImageData can contain noise from browser fingerprinting protection.
  // The threshold removes it, and the PNG is made from the mask, not from a canvas.
  const mask = toMask(ctx.getImageData(0, 0, p.dw, p.dh).data);
  ctx.putImageData(new ImageData(maskToRgba(mask), p.dw, p.dh), 0, 0);

  const full = placeMask(mask, p.dw, p.dh, page.width, page.height, p.dx, p.dy);
  const png = await encodeBilevelPng(full, page.width, page.height);
  return { blob: new Blob([png], { type: 'image/png' }), label, placement: p };
}

/**
 * Paper PNG through canvas.toBlob. Browsers with fingerprinting protection can add noise.
 * @param {HTMLCanvasElement} label @param {Placement} p
 * @param {{width: number, height: number}} size
 * @returns {Promise<Blob>}
 */
function grayscalePng(label, p, size) {
  const page = document.createElement('canvas');
  page.width = size.width;
  page.height = size.height;
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
export function context2d(canvas, settings) {
  const ctx = canvas.getContext('2d', settings);
  if (!ctx) throw new Error('Canvas 2D is not available');
  return ctx;
}
