import { test } from 'vitest';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { crc32, encodeBilevelPng } from '../../src/png.js';

/** @param {Uint8Array} png */
function readChunks(png) {
  const buf = Buffer.from(png);
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = [];
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    assert.equal(
      buf.readUInt32BE(o + 8 + len),
      zlib.crc32(buf.subarray(o + 4, o + 8 + len)),
      `${type} CRC`,
    );
    chunks.push({ type, data });
    o += 12 + len;
  }
  return chunks;
}

test('crc32 gives the standard value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('encodeBilevelPng writes a valid 1-bit grayscale PNG with the same pixels', async () => {
  const width = 11,
    height = 3; // width is not a multiple of 8, to test the padding bits
  const mask = new Uint8Array(width * height);
  mask[0] = 1;
  mask[width + 5] = 1;
  mask[3 * width - 1] = 1;

  const chunks = readChunks(await encodeBilevelPng(mask, width, height));
  assert.deepEqual(
    chunks.map((c) => c.type),
    ['IHDR', 'pHYs', 'IDAT', 'IEND'],
  );

  const ihdr = chunks[0].data;
  assert.equal(ihdr.readUInt32BE(0), width);
  assert.equal(ihdr.readUInt32BE(4), height);
  assert.equal(ihdr[8], 1); // bit depth
  assert.equal(ihdr[9], 0); // grayscale
  assert.equal(chunks[1].data.readUInt32BE(0), 11811); // 300 DPI

  const raw = zlib.inflateSync(chunks[2].data);
  const rowBytes = Math.ceil(width / 8);
  const decoded = [];
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (rowBytes + 1)], 0); // filter: none
    for (let x = 0; x < width; x++) {
      const bit = (raw[y * (rowBytes + 1) + 1 + (x >> 3)] >> (7 - (x & 7))) & 1;
      decoded.push(bit ? 0 : 1); // gray 1 = white = mask 0
    }
  }
  assert.deepEqual(decoded, [...mask]);
});
