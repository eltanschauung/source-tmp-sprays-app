import test from 'node:test';
import assert from 'node:assert/strict';
import { markKey, loadMarks, saveMarks, relativePath, batchScript, shellScript } from '../src/marks.js';
import { decodeVtfFrames } from '../src/decode.js';
import { sheetLayout } from '../src/animation.js';
import { rgbaFixture, dxtFixture } from './fixtures.js';

test('marks key on the normalized hash, falling back to path for unreadable files', () => {
  assert.equal(markKey({ fingerprint: 'abc', path: 'temp/a.vtf' }), 'md5:abc');
  assert.equal(markKey({ path: 'temp/broken.vtf' }), 'path:temp/broken.vtf');
});

test('marks persist through storage and tolerate corrupt or blocked storage', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  saveMarks(storage, new Set(['md5:abc', 'path:x.vtf']));
  assert.deepEqual([...loadMarks(storage)], ['md5:abc', 'path:x.vtf']);
  data.set('source-sprays-marked', '{not json');
  assert.equal(loadMarks(storage).size, 0);
  data.set('source-sprays-marked', '[1, "md5:ok", null]');
  assert.deepEqual([...loadMarks(storage)], ['md5:ok']);
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(loadMarks(blocked).size, 0);
  assert.doesNotThrow(() => saveMarks(blocked, new Set(['a'])));
  assert.equal(loadMarks(null).size, 0);
});

test('paths are made relative to the opened folder', () => {
  assert.equal(relativePath('temp/nested/a.vtf', 'temp'), 'nested/a.vtf');
  assert.equal(relativePath('a.vtf', ''), 'a.vtf');
  assert.equal(relativePath('tempo/a.vtf', 'temp'), 'tempo/a.vtf');
});

test('Windows script escapes percent signs, uses backslashes and skips impossible names', () => {
  const script = batchScript(['nested/a b&c.vtf', '100%.vtf', 'bad"name.vtf', 'evil\r\ndel *.vtf']);
  assert.match(script, /^@echo off\r\n/);
  assert.ok(script.includes('if exist "nested\\a b&c.vtf" del /f /q "nested\\a b&c.vtf"\r\n'));
  assert.ok(script.includes('if exist "100%%.vtf" del /f /q "100%%.vtf"'));
  assert.ok(!script.includes('bad"name'));
  assert.ok(!script.includes('evil'));
  assert.ok(script.includes('This deletes 2 marked spray files'));
});

test('shell script quotes every path and confirms before deleting', () => {
  const script = shellScript(["it's.vtf", '-rf.vtf', 'line\nbreak.vtf', '$(id).vtf']);
  assert.ok(script.includes(`set -- 'it'\\''s.vtf' '-rf.vtf' 'line\nbreak.vtf' '$(id).vtf'\n`));
  assert.ok(script.includes('rm -f -- "$@"'));
  assert.ok(script.indexOf('read -r answer') < script.indexOf('rm -f'));
});

test('animation frames decode into one packed buffer within the pixel budget', async () => {
  const buffer = await rgbaFixture({ frames: 2 });
  const full = await decodeVtfFrames(buffer, { maxDimension: 256 });
  assert.equal(full.frames, 2);
  assert.equal(full.frameWidth, 64);
  assert.equal(full.pixels.length, 64 * 64 * 4 * 2);
  assert.deepEqual([...full.pixels.slice(64 * 64 * 4, 64 * 64 * 4 + 4)], [30, 180, 240, 255]);
  // Files without mipmaps are halved in the worker until they fit.
  const small = await decodeVtfFrames(buffer, { maxDimension: 256, maxPixels: 2 * 32 * 32 });
  assert.equal(small.frameWidth, 32);
  assert.equal(small.pixels.length, 32 * 32 * 4 * 2);
  assert.deepEqual([...small.pixels.slice(32 * 32 * 4, 32 * 32 * 4 + 4)], [30, 180, 240, 255]);
  const mipped = await decodeVtfFrames(await rgbaFixture({ width: 512, height: 512, frames: 2, mips: 3 }), { maxDimension: 256 });
  assert.equal(mipped.frameWidth, 256);
  const long = await decodeVtfFrames(dxtFixture(13, 2000));
  assert.equal(long.pixels.length, 4 * 4 * 4 * 2000);
});

test('frame sheets use a near-square grid', () => {
  assert.deepEqual(sheetLayout(1), { columns: 1, rows: 1 });
  assert.deepEqual(sheetLayout(2), { columns: 2, rows: 1 });
  assert.deepEqual(sheetLayout(10), { columns: 4, rows: 3 });
});
