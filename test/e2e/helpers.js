import { Buffer } from 'node:buffer';
import zlib from 'node:zlib';

/** Page box of the test PDF, in PDF points (Letter). */
export const PAGE = { width: 612, height: 792 };

/** The black frame that the test PDF draws, as page fractions from the top left. */
export const FRAME = { x0: 72 / 612, y0: 72 / 792, x1: 306 / 612, y1: 216 / 792 };

/**
 * Make a small Letter PDF. Each page has a light gray background (like the
 * haze on real labels), a 4 pt black frame at FRAME, a text line, and a
 * mid-gray bar.
 * @param {number} [pages]
 */
export function makeTestPdf(pages = 1) {
  const content = (/** @type {number} */ n) =>
    [
      '0.93 g 0 0 612 792 re f',
      '0 G 4 w 72 576 234 144 re S',
      `0 g BT /F1 24 Tf 90 650 Td (CROPR TEST ${n}) Tj ET`,
      '0.5 g 72 300 468 20 re f',
    ].join('\n') + '\n';

  // Objects: 1 catalog, 2 pages, 3 font, then (page, content) pairs
  const kids = Array.from({ length: pages }, (_, i) => `${4 + 2 * i} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (let i = 0; i < pages; i++) {
    const stream = content(i + 1);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + 2 * i} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    );
  }

  let out = '%PDF-1.4\n';
  const offsets = objects.map((obj, i) => {
    const offset = out.length;
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/**
 * Decode a 1-bit grayscale PNG (the format that Cropr writes).
 * @param {Buffer} png
 * @returns {{width: number, height: number, bitDepth: number, colorType: number, isBlack: (x: number, y: number) => boolean}}
 */
export function decodeBilevelPng(png) {
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  /** @type {Buffer[]} */
  const idat = [];
  for (let o = 8; o < png.length;) {
    const len = png.readUInt32BE(o);
    const type = png.toString('latin1', o + 4, o + 8);
    const data = png.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    }
    if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rowBytes = Math.ceil(width / 8) + 1;
  return {
    width,
    height,
    bitDepth,
    colorType,
    isBlack: (x, y) => ((raw[y * rowBytes + 1 + (x >> 3)] >> (7 - (x & 7))) & 1) === 0,
  };
}

/**
 * Count black pixels in a rectangle of a decoded PNG.
 * @param {ReturnType<typeof decodeBilevelPng>} img
 */
export function countBlack(img, x0 = 0, y0 = 0, x1 = img.width, y1 = img.height) {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (img.isBlack(x, y)) n++;
  return n;
}

/**
 * Act like browser fingerprinting protection (Safari, Brave, Firefox RFP):
 * canvas read-back gets small random noise. Runs in the page.
 */
export function addCanvasNoise() {
  const get = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function (...args) {
    const img = get.apply(this, /** @type {Parameters<typeof get>} */ (args));
    for (let i = 0; i < img.data.length; i++) {
      if ((i & 3) !== 3) img.data[i] -= (Math.random() * 6) | 0;
    }
    return img;
  };
  const toBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (...args) {
    const ctx = this.getContext('2d');
    if (ctx) ctx.putImageData(ctx.getImageData(0, 0, this.width, this.height), 0, 0);
    return toBlob.apply(this, /** @type {Parameters<typeof toBlob>} */ (args));
  };
}
