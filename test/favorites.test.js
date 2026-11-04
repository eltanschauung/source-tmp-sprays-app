import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFavorites, saveFavorites, defaultSprayName, validateSprayNames, installBatchScript, installShellScript } from '../src/favorites.js';

test('favorites persist names and tolerate corrupt or blocked storage', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  saveFavorites(storage, new Map([['md5:abc', 'Kogasa'], ['path:x.vtf', 'Other']]));
  assert.deepEqual([...loadFavorites(storage)], [['md5:abc', 'Kogasa'], ['path:x.vtf', 'Other']]);
  data.set('source-sprays-favorites', '["not", "a map"]');
  assert.equal(loadFavorites(storage).size, 0);
  data.set('source-sprays-favorites', '{"md5:a": "ok", "md5:b": 5}');
  assert.deepEqual([...loadFavorites(storage)], [['md5:a', 'ok']]);
  assert.equal(loadFavorites({ getItem() { throw new Error('denied'); } }).size, 0);
  assert.doesNotThrow(() => saveFavorites({ setItem() { throw new Error('denied'); } }, new Map()));
});

test('default names come from the filename and are always installable', () => {
  assert.equal(defaultSprayName('0000d347.vtf'), '0000d347');
  assert.equal(defaultSprayName('my spray (2).VTF'), 'my spray _2_');
  assert.equal(defaultSprayName('%%%.vtf'), '_');
  assert.equal(defaultSprayName('.vtf'), 'spray');
  assert.equal(validateSprayNames([defaultSprayName('a&b%c!.vtf')]).size, 0);
});

test('names must be safe and unique (ignoring case)', () => {
  const errors = validateSprayNames(['Kogasa', 'kogasa', '', ' padded', 'bad&name', 'ok name_2-x', 'x'.repeat(65)]);
  assert.deepEqual([...errors.keys()], [1, 2, 3, 4, 6]);
  assert.match(errors.get(1), /Same name as "Kogasa"/);
  assert.match(errors.get(2), /Enter a name/);
});

test('Windows install script copies, writes both VMTs, and never overwrites', () => {
  const script = installBatchScript([
    { path: 'nested/0000d347.vtf', name: 'Kogasa' },
    { path: '100%.vtf', name: 'Percent' },
    { path: 'a.vtf', name: 'bad&name' },
  ]);
  assert.match(script, /^@echo off\r\n/);
  assert.ok(script.includes('call :install "nested\\0000d347.vtf" "Kogasa"\r\n'));
  assert.ok(!script.includes('Percent'));
  assert.ok(!script.includes('bad&name'));
  assert.ok(script.includes('This installs 1 favorite spray into:'));
  assert.ok(script.includes('if exist "%LOGOS%\\%~2.vtf" goto exists'));
  assert.ok(script.includes('>"%LOGOS%\\%~2.vmt" echo "UnlitGeneric"'));
  assert.ok(script.includes('>>"%LOGOS%\\%~2.vmt" echo \t"$basetexture"\t"vgui/logos/%~2"'));
  assert.ok(script.includes('>>"%LOGOS%\\ui\\%~2.vmt" echo \t"$basetexture" "VGUI/logos/%~2"'));
  assert.ok(script.indexOf('pause') < script.indexOf('call :install'));
});

test('shell install script quotes paths and fills the VMT name with printf', () => {
  const script = installShellScript([{ path: "it's/0000d347.vtf", name: 'Kogasa' }, { path: 'x.vtf', name: '$(id)' }]);
  assert.ok(script.includes(`install 'it'\\''s/0000d347.vtf' 'Kogasa'\n`));
  assert.ok(!script.includes('$(id)'));
  assert.ok(script.includes(`printf '"UnlitGeneric"\\n{\\n\\t"$basetexture"\\t"vgui/logos/%s"\\n`));
  assert.ok(script.indexOf('read -r answer') < script.indexOf('install \''));
});
