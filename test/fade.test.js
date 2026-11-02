import test from 'node:test';
import assert from 'node:assert/strict';
import { Vtf } from 'vtf-js';
import { decodeVtf, decodeVtfFrames, fadeLevels } from '../src/decode.js';
import { inspectVtf } from '../src/catalog.js';
import { rgbaFixture, fadeFixture } from './fixtures.js';

async function levels(buffer) {
  return fadeLevels(await Vtf.decode(buffer, { onDemand: true, noClone: true }), inspectVtf(buffer));
}

test('ordinary mipmaps are not mistaken for distance fades', async () => {
  assert.deepEqual(await levels(await rgbaFixture({ mips: 3 })), []);
  assert.deepEqual(await levels(await rgbaFixture({ width: 512, height: 512, mips: 7 })), []);
  assert.deepEqual(await levels(await rgbaFixture()), []);
});

test('fade sprays report the levels that start a new picture', async () => {
  assert.deepEqual(await levels(await fadeFixture()), [1]);
});

test('fade sprays preview their closest picture and decode any distance level', async () => {
  const buffer = await fadeFixture();
  const thumbnail = await decodeVtf(buffer, { maxDimension: 32 });
  assert.equal(thumbnail.imageWidth, 64);
  assert.deepEqual(thumbnail.fades, [1]);
  assert.equal(thumbnail.fadeImages.length, 1);
  assert.equal(thumbnail.fadeImages[0].imageWidth, 32);
  assert.deepEqual([...thumbnail.fadeImages[0].pixels.slice(0, 4)], [0, 255, 0, 255]);
  assert.deepEqual([...thumbnail.pixels.slice(8 * 4, 8 * 4 + 4)], [220, 60, 80, 255]);
  const far = await decodeVtf(buffer, { mip: 1 });
  assert.deepEqual(far.fadeImages, []);
  assert.equal(far.imageWidth, 32);
  assert.deepEqual([...far.pixels.slice(0, 4)], [0, 255, 0, 255]);
  // Ordinary sprays still use a smaller mip for thumbnails.
  assert.equal((await decodeVtf(await rgbaFixture({ mips: 3 }), { maxDimension: 32 })).imageWidth, 32);
  // Animation sheets shrink the close picture instead of using other pictures.
  const frames = await decodeVtfFrames(buffer, { maxDimension: 32 });
  assert.equal(frames.frameWidth, 32);
  assert.notDeepEqual([...frames.pixels.slice(0, 4)], [0, 255, 0, 255]);
});
