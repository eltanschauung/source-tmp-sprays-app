import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectVtf, sortEntries, exportLayout, formatBytes, MAX_FILE_BYTES } from '../src/catalog.js';
import { decodeVtf } from '../src/decode.js';
import { rgbaFixture, dxtFixture } from './fixtures.js';

for (const version of [0, 1, 2, 3, 4, 5, 6]) test(`VTF 7.${version}: RGBA decode and resource table`, async () => {
  const buffer = await rgbaFixture({ version });
  const decoded = await decodeVtf(buffer);
  assert.equal(decoded.width, 64);
  assert.equal(decoded.height, 64);
  assert.deepEqual([...decoded.pixels.slice(8 * 4, 8 * 4 + 4)], [220, 60, 80, 255]);
});

for (const format of [13, 14, 15]) test(`DXT format ${format}: real decompression`, async () => {
  const decoded = await decodeVtf(dxtFixture(format));
  assert.deepEqual([...decoded.pixels.slice(0, 4)], [255, 0, 0, 255]);
});

test('animation frames and thumbnail mip selection', async () => {
  const buffer = await rgbaFixture({ width: 512, height: 512, frames: 2, mips: 3 });
  const first = await decodeVtf(buffer, { maxDimension: 256 });
  const second = await decodeVtf(buffer, { frame: 1, maxDimension: 512 });
  assert.equal(first.frames, 2);
  assert.equal(first.imageWidth, 256);
  assert.deepEqual([...second.pixels.slice(0, 4)], [30, 180, 240, 255]);
});

test('long low-resolution animations remain valid without decoding every frame', async () => {
  const decoded = await decodeVtf(dxtFixture(13, 2000), { frame: 1999 });
  assert.equal(decoded.frames, 2000);
  assert.deepEqual([...decoded.pixels.slice(0, 4)], [255, 0, 0, 255]);
});

test('rejects bad signatures, truncation, dimensions, frames, resource count and huge files', async () => {
  assert.throws(() => inspectVtf(new ArrayBuffer(4)), /Truncated/);
  assert.throws(() => inspectVtf(new ArrayBuffer(80)), /Not a Valve/);
  const original = await rgbaFixture();
  for (const [offset, value, bits, expected] of [[16, 65535, 16, /dimensions/], [24, 65535, 16, /animation/], [68, 10000, 32, /resource/], [20, 0x4000, 32, /Cubemap/]]) {
    const copy = original.slice(0);
    new DataView(copy)[`setUint${bits}`](offset, value, true);
    assert.throws(() => inspectVtf(copy), expected);
  }
  assert.throws(() => inspectVtf(original, MAX_FILE_BYTES + 1), /64 MB/);
  await assert.rejects(() => decodeVtf(original.slice(0, 100)));
});

test('date/size sorts use real file metadata, ties deterministic, filtering non-mutating', () => {
  const entries = [{ path: 'temp/b.vtf', file: { size: 1, lastModified: 20 } }, { path: 'temp/a.vtf', file: { size: 5, lastModified: 10 } }, { path: 'temp/c.vtf', file: { size: 5, lastModified: 10 } }];
  assert.deepEqual(sortEntries(entries, 'date').map(x => x.path), ['temp/b.vtf', 'temp/a.vtf', 'temp/c.vtf']);
  assert.deepEqual(sortEntries(entries, 'size').map(x => x.path), ['temp/a.vtf', 'temp/c.vtf', 'temp/b.vtf']);
  assert.deepEqual(sortEntries(entries, 'date', false).map(x => x.path), ['temp/a.vtf', 'temp/c.vtf', 'temp/b.vtf']);
  assert.equal(sortEntries(entries, 'name', false, 'A.VTF').length, 1);
  assert.equal(entries[0].path, 'temp/b.vtf');
});

test('bounded export layout covers every image, byte formatting', () => {
  for (const count of [1, 7, 200, 10000]) {
    const layout = exportLayout(count, 6);
    assert.ok(layout.columns * layout.rows >= count);
    assert.ok(layout.width <= 8192 && layout.height <= 8192 && layout.width * layout.height <= 32_000_000);
  }
  assert.throws(() => exportLayout(0), /No decoded/);
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.0 KB');
});
