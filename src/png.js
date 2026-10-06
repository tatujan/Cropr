/* Minimal PNG encoder for 1-bit grayscale (bilevel) images. No DOM access.
 *
 * Why: some browsers (Safari Advanced Fingerprinting Protection, Brave,
 * Firefox resistFingerprinting) add small noise to the pixels that canvas
 * toBlob/toDataURL/getImageData give. White 255 becomes 250..254, and printers
 * print that as faint gray streaks. A PNG that this file writes from a clean
 * mask can only hold pure black and pure white, and it has no color profile.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** @param {Uint8Array} bytes @returns {number} */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {string} type @param {Uint8Array} data */
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * zlib-format deflate with the built-in CompressionStream (browsers and Node 18+).
 * @param {Uint8Array<ArrayBuffer>} bytes
 */
async function zlibDeflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @param {Uint8Array} mask  width × height values, 1 = black, 0 = white
 * @param {number} width @param {number} height
 * @returns {Promise<Uint8Array<ArrayBuffer>>} PNG file bytes
 */
export async function encodeBilevelPng(mask, width, height, { dpi = 300 } = {}) {
  const rowBytes = Math.ceil(width / 8);
  const raw = new Uint8Array((rowBytes + 1) * height); // each row: filter byte 0, then packed bits

  for (let y = 0; y < height; y++) {
    const rowStart = y * (rowBytes + 1) + 1;
    raw.fill(0xff, rowStart, rowStart + rowBytes); // white, also for the padding bits
    const m = y * width;
    for (let x = 0; x < width; x++) {
      if (mask[m + x]) raw[rowStart + (x >> 3)] &= ~(0x80 >> (x & 7)); // grayscale 0 = black
    }
  }

  const ihdr = new Uint8Array(13);
  const ih = new DataView(ihdr.buffer);
  ih.setUint32(0, width);
  ih.setUint32(4, height);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 0; // color type: grayscale
  // compression, filter and interlace methods stay 0

  const phys = new Uint8Array(9);
  const ppm = Math.round(dpi / 0.0254); // pixels per metre
  const ph = new DataView(phys.buffer);
  ph.setUint32(0, ppm);
  ph.setUint32(4, ppm);
  phys[8] = 1; // unit: metre

  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk('IHDR', ihdr),
    chunk('pHYs', phys),
    chunk('IDAT', await zlibDeflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    png.set(p, offset);
    offset += p.length;
  }
  return png;
}
