import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizedVtfMd5, deduplicateEntries } from '../src/duplicates.js';
import { rgbaFixture } from './fixtures.js';

test('normalized MD5 matches Node crypto and leaves original VTF bytes untouched', async () => {
  const plain = await rgbaFixture();
  const stamped = plain.slice(0);
  new Uint8Array(stamped).set(new TextEncoder().encode('IS14'), 28);
  const before = stamped.slice(0);
  const expected = createHash('md5').update(new Uint8Array(plain)).digest('hex');
  assert.equal(normalizedVtfMd5(stamped), expected);
  assert.equal(normalizedVtfMd5(plain), expected);
  assert.deepEqual(stamped, before);
});

test('only padding is ignored, not header settings, image pixels, or later animation frames', async () => {
  const original = await rgbaFixture({ frames: 2 });
  const padding = original.slice(0);
  new Uint8Array(padding).set([10, 20, 30, 40], 28);
  assert.equal(normalizedVtfMd5(padding), normalizedVtfMd5(original));
  for (const offset of [20, 32, original.byteLength - 1]) {
    const changed = original.slice(0);
    new Uint8Array(changed)[offset] ^= 1;
    assert.notEqual(normalizedVtfMd5(changed), normalizedVtfMd5(original));
  }
});

test('bad and empty files cannot receive a normalized VTF fingerprint', () => {
  assert.throws(() => normalizedVtfMd5(new ArrayBuffer(0)), /Truncated/);
  assert.throws(() => normalizedVtfMd5(new ArrayBuffer(80)), /Not a Valve/);
});

test('newest copy wins independently of selection or worker completion order', () => {
  const old = { path: 'a-old.vtf', file: { lastModified: 10 }, fingerprint: 'same' };
  const middle = { path: 'b-middle.vtf', file: { lastModified: 20 }, fingerprint: 'same' };
  const latest = { path: 'z-latest.vtf', file: { lastModified: 30 }, fingerprint: 'same' };
  const other = { path: 'other.vtf', file: { lastModified: 0 }, fingerprint: 'different' };
  for (const entries of [[old, middle, latest, other], [latest, middle, old, other], [middle, other, latest, old]]) {
    const result = deduplicateEntries(entries);
    assert.equal(result.duplicates, 2);
    assert.equal(result.entries.length, 2);
    assert.ok(result.entries.includes(latest));
    assert.ok(result.entries.includes(other));
    assert.equal(entries.length, 4);
  }
});

test('equal timestamps have a stable path tiebreaker and unreadable files remain independent', () => {
  const a = { path: 'nested/a.vtf', file: { lastModified: 10 }, fingerprint: 'same' };
  const b = { path: 'z.vtf', file: { lastModified: 10 }, fingerprint: 'same' };
  const bad1 = { path: 'bad1.vtf', file: { lastModified: 0 } };
  const bad2 = { path: 'bad2.vtf', file: { lastModified: 0 } };
  for (const entries of [[b, a, bad1, bad2], [a, b, bad1, bad2]]) {
    const result = deduplicateEntries(entries);
    assert.deepEqual(result.entries, [a, bad1, bad2]);
    assert.equal(result.duplicates, 1);
  }
});
