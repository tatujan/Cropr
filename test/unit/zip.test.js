import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from '../../src/png.js';
import { storeZip } from '../../src/zip.js';

const files = [
  { name: 'label-page-1.png', data: Uint8Array.of(1, 2, 3, 4) },
  { name: 'label-page-2.png', data: new TextEncoder().encode('second file') },
];

test('storeZip writes local headers with the data, CRC and sizes', () => {
  const zip = Buffer.from(storeZip(files, new Date(2026, 9, 6, 12, 30, 0)));
  let o = 0;
  for (const f of files) {
    assert.equal(zip.readUInt32LE(o), 0x04034b50);
    assert.equal(zip.readUInt16LE(o + 8), 0); // store
    assert.equal(zip.readUInt32LE(o + 14), crc32(f.data));
    assert.equal(zip.readUInt32LE(o + 18), f.data.length);
    const nameLen = zip.readUInt16LE(o + 26);
    assert.equal(zip.toString('utf8', o + 30, o + 30 + nameLen), f.name);
    const start = o + 30 + nameLen;
    assert.deepEqual([...zip.subarray(start, start + f.data.length)], [...f.data]);
    o = start + f.data.length;
  }
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  assert.equal(zip.readUInt16LE(end + 10), files.length);
  assert.equal(zip.readUInt32LE(end + 16), o); // central directory starts after the data
});

test('storeZip output passes the unzip integrity test', (t) => {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
  } catch {
    t.skip();
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'cropr-zip-'));
  const path = join(dir, 'labels.zip');
  writeFileSync(path, storeZip(files));
  execFileSync('unzip', ['-tq', path]);
  execFileSync('unzip', ['-oq', path, '-d', dir]);
  assert.equal(readFileSync(join(dir, 'label-page-2.png'), 'utf8'), 'second file');
});
