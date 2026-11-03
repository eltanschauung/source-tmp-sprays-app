import { test, expect } from '@playwright/test';
import { rgbaFixture, dxtFixture, fadeFixture } from '../fixtures.js';
import { mkdir, writeFile, utimes } from 'node:fs/promises';
import path from 'node:path';

const folder = path.resolve('.local/fixture-temp');
test.beforeAll(async () => {
  await mkdir(path.join(folder, 'nested'), { recursive: true });
  for (const [name, buffer, modified] of [
    ['a-old.vtf', await rgbaFixture({ color: [220, 60, 80, 255] }), 1600000000],
    ['b-new.VTF', dxtFixture(15), 1700000000],
    ['nested/c-animated.vtf', await rgbaFixture({ frames: 2 }), 1650000000],
  ]) {
    const file = path.join(folder, name);
    await writeFile(file, new Uint8Array(buffer));
    await utimes(file, modified, modified);
  }
  await writeFile(path.join(folder, 'broken.vtf'), 'bad vtf');
  await writeFile(path.join(folder, 'ignored.vmt'), 'not a texture');
});

test('folder import, decoding, date and size sorts, details, animation, PNG downloads, no uploads', async ({ page }, testInfo) => {
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push([request.method(), request.resourceType()]));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Spray collection' })).toBeVisible();
  await page.selectOption('#sort', { label: 'Animated' });
  await page.locator('#folder-input').setInputFiles(folder);
  await expect(page.locator('#summary')).toHaveText('3 sprays / 1 unreadable');
  await expect(page.locator('.spray-button img')).toHaveCount(3);
  await expect(page.locator('#notice')).toHaveText('1 non-VTF file skipped.');
  await expect(page.locator('.tile-name').first()).toHaveText('c-animated.vtf');
  await page.getByRole('button', { name: 'Animated first', exact: true }).click();
  await expect(page.locator('.tile-name').last()).toHaveText('c-animated.vtf');
  await page.getByRole('button', { name: 'Still images first', exact: true }).click();
  await expect(page.locator('.tile-name').first()).toHaveText('c-animated.vtf');
  await page.selectOption('#sort', 'date');
  // The broken file is newest; then b-new, animated, a-old.
  await expect(page.locator('.tile-name').nth(1)).toHaveText('b-new.VTF');
  await page.getByRole('button', { name: 'Newest first', exact: true }).click();
  await expect(page.locator('.tile-name').first()).toHaveText('a-old.vtf');
  await page.selectOption('#sort', 'size');
  await expect(page.locator('.tile-name').first()).toHaveText('broken.vtf');
  await page.getByRole('button', { name: 'Smallest first', exact: true }).click();
  await expect(page.locator('.tile-name').first()).toHaveText('c-animated.vtf');
  await page.locator('#search').fill('c-animated');
  await expect(page.locator('.spray-tile:visible')).toHaveCount(1);
  await page.getByRole('button', { name: 'View c-animated.vtf', exact: true }).click();
  await expect(page.locator('#viewer')).toBeVisible();
  await expect(page.locator('#download-image')).toBeEnabled();
  await page.locator('#frame').fill('1');
  await page.locator('#frame').dispatchEvent('change');
  await expect(page.locator('#frame-number')).toHaveText('2 / 2');
  await expect(page.locator('#download-image')).toBeEnabled();
  const imageDownload = page.waitForEvent('download');
  await page.locator('#download-image').click();
  expect((await imageDownload).suggestedFilename()).toBe('c-animated-frame-2.png');
  await page.locator('#close-viewer').click();
  await page.locator('#search').fill('');
  // Resolution filter lists the sizes present, largest first, with counts.
  await expect(page.locator('#resolution option')).toHaveText(['All sizes', '64 x 64 (2)', '4 x 4 (1)']);
  await page.locator('#resolution').selectOption('4x4');
  await expect(page.locator('.spray-tile:visible .tile-name')).toHaveText(['b-new.VTF']);
  await page.locator('#resolution').selectOption('');
  await expect(page.locator('.spray-tile:visible')).toHaveCount(4);
  const download = page.waitForEvent('download');
  await page.locator('#export').click();
  expect((await download).suggestedFilename()).toBe('source-sprays-collage.png');
  await page.screenshot({ path: `.local/${testInfo.project.name}-collage.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  expect(requests.filter(([method, type]) => method !== 'GET' || ['fetch', 'xhr', 'websocket'].includes(type))).toEqual([]);
  await page.locator('#clear').click();
  await expect(page.locator('#summary')).toHaveText('No folder selected');
  await expect(page.locator('.spray-tile')).toHaveCount(0);
});

test('individual file picker, empty folder, replacement during decode, filename escaping', async ({ page }) => {
  await page.goto('./');
  await page.locator('#file-input').setInputFiles({ name: '<img onerror=alert(1)>.vtf', mimeType: 'application/octet-stream', buffer: Buffer.from(await rgbaFixture()) });
  await expect(page.locator('#summary')).toHaveText('1 spray');
  await expect(page.locator('.tile-name')).toHaveText('<img onerror=alert(1)>.vtf');
  await page.locator('#folder-input').setInputFiles(folder);
  await page.locator('#clear').click();
  await expect(page.locator('#summary')).toHaveText('No folder selected');
  await page.locator('#file-input').setInputFiles(path.join(folder, 'ignored.vmt'));
  await expect(page.locator('#notice')).toHaveText('No .vtf files found in this selection.');
});

test('stamped duplicates keep only the newest copy across sorting, filtering, viewing and export', async ({ page }) => {
  const dir = path.resolve('.local/duplicate-temp');
  await mkdir(dir, { recursive: true });
  const original = await rgbaFixture({ frames: 2 });
  const stamped = original.slice(0);
  new Uint8Array(stamped).set(new TextEncoder().encode('IS14'), 28);
  const differentAnimation = original.slice(0);
  new Uint8Array(differentAnimation)[differentAnimation.byteLength - 1] ^= 1;
  for (const [name, buffer, time] of [
    ['old-stamped.vtf', stamped, 1600000000],
    ['middle-identical.vtf', original, 1650000000],
    ['newest-original.vtf', original, 1700000000],
    ['different-animation.vtf', differentAnimation, 1750000000],
  ]) {
    const filename = path.join(dir, name);
    await writeFile(filename, new Uint8Array(buffer));
    await utimes(filename, time, time);
  }
  await page.goto('./');
  await page.locator('#folder-input').setInputFiles(dir);
  await expect(page.locator('#summary')).toHaveText('2 sprays / 2 duplicates hidden');
  await expect(page.locator('.spray-tile')).toHaveCount(2);
  await expect(page.locator('.tile-name')).toHaveText(['different-animation.vtf', 'newest-original.vtf']);
  await page.locator('#direction').click();
  await expect(page.locator('.tile-name')).toHaveText(['newest-original.vtf', 'different-animation.vtf']);
  await page.locator('#sort').selectOption('name');
  await expect(page.locator('.tile-name')).toHaveText(['different-animation.vtf', 'newest-original.vtf']);
  await page.locator('#search').fill('old-stamped');
  await expect(page.locator('#no-results')).toBeVisible();
  await page.locator('#search').fill('');
  await page.getByRole('button', { name: 'View newest-original.vtf', exact: true }).click();
  await expect(page.locator('#download-image')).toBeEnabled();
  await page.locator('#close-viewer').click();
  const downloaded = page.waitForEvent('download');
  await page.locator('#export').click();
  const chunks = [];
  for await (const chunk of await (await downloaded).createReadStream()) chunks.push(chunk);
  const png = Buffer.concat(chunks);
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.readUInt32BE(16) * png.readUInt32BE(20)).toBe(2 * 256 * 256);
  // The source files remain byte-for-byte intact, including the IS14 stamp.
  const { readFile } = await import('node:fs/promises');
  expect(await readFile(path.join(dir, 'old-stamped.vtf'))).toEqual(Buffer.from(stamped));
  // Hidden older copies can be added to the deletion list without marking the kept copy.
  await expect(page.locator('#marked')).toBeEnabled();
  await expect(page.locator('#marked-count')).toHaveText('0');
  await page.locator('#marked').click();
  await page.locator('#toggle-duplicates').click();
  await expect(page.locator('#toggle-duplicates')).toHaveText('Remove 2 duplicate copies');
  await expect(page.locator('#marked-list li span')).toHaveText(['middle-identical.vtf', 'old-stamped.vtf']);
  await expect(page.locator('#marked-list button')).toHaveCount(0);
  await expect(page.locator('#marked-count')).toHaveText('2');
  await expect(page.locator('.spray-tile:visible')).toHaveCount(2);
  await page.locator('#toggle-duplicates').click();
  await expect(page.locator('#toggle-duplicates')).toHaveText('Add 2 duplicate copies');
  await expect(page.locator('#marked-summary')).toHaveText('Nothing in this folder is marked.');
  await page.locator('#close-marked').click();
  await page.locator('#clear').click();
  await expect(page.locator('#summary')).toHaveText('No folder selected');
  await page.locator('#file-input').setInputFiles(path.join(dir, 'old-stamped.vtf'));
  await expect(page.locator('#summary')).toHaveText('1 spray');
});

test('marking hides sprays, persists across imports, excludes them from export and builds delete scripts', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await page.locator('#folder-input').setInputFiles(folder);
  await expect(page.locator('#summary')).toHaveText('3 sprays / 1 unreadable');
  await expect(page.locator('#marked')).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Mark c-animated.vtf for deletion' }).check();
  await page.getByRole('checkbox', { name: 'Mark broken.vtf for deletion' }).check();
  await expect(page.locator('.spray-tile:visible')).toHaveCount(2);
  await expect(page.locator('#summary')).toHaveText('3 sprays / 1 unreadable / 2 marked');
  // Marks made while the floating toast is up are grouped and undone together.
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toast-text')).toHaveText('2 sprays marked for deletion and hidden.');
  expect(await page.locator('#toast').evaluate(toast => getComputedStyle(toast).position)).toBe('fixed');
  await page.locator('#toast-undo').click();
  await expect(page.locator('#toast')).toBeHidden();
  await expect(page.locator('.spray-tile:visible')).toHaveCount(4);
  await page.getByRole('checkbox', { name: 'Mark c-animated.vtf for deletion' }).check();
  await expect(page.locator('#toast-text')).toHaveText('c-animated.vtf marked for deletion and hidden.');
  await page.locator('#toast-close').click();
  await expect(page.locator('#toast')).toBeHidden();
  await page.getByRole('checkbox', { name: 'Mark broken.vtf for deletion' }).check();
  await page.locator('#show-marked').check();
  await expect(page.locator('.spray-tile:visible')).toHaveCount(4);
  await expect(page.locator('.spray-tile.marked')).toHaveCount(2);
  await page.locator('#show-marked').uncheck();
  await page.locator('#marked').click();
  await expect(page.locator('#marked-list li span')).toHaveText(['broken.vtf', 'nested/c-animated.vtf']);
  const script = page.waitForEvent('download');
  await page.locator('#script-windows').click();
  const download = await script;
  expect(download.suggestedFilename()).toBe('delete-marked-sprays.bat');
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString();
  expect(text).toContain('if exist "nested\\c-animated.vtf" del /f /q "nested\\c-animated.vtf"');
  expect(text).toContain('if exist "broken.vtf" del /f /q "broken.vtf"');
  await page.locator('#close-marked').click();
  // Collage export leaves marked sprays out: 2 remaining stills.
  const collage = page.waitForEvent('download');
  await page.locator('#export').click();
  const png = [];
  for await (const chunk of await (await collage).createReadStream()) png.push(chunk);
  const image = Buffer.concat(png);
  expect(image.readUInt32BE(16) * image.readUInt32BE(20)).toBe(2 * 256 * 256);
  // Marks survive a reload and re-import.
  await page.reload();
  await page.locator('#folder-input').setInputFiles(folder);
  await expect(page.locator('#summary')).toHaveText('3 sprays / 1 unreadable / 2 marked');
  await expect(page.locator('.spray-tile:visible')).toHaveCount(2);
  await expect(page.locator('#notice')).toContainText('2 previously marked sprays are hidden.');
  await page.locator('#marked').click();
  await page.getByRole('button', { name: 'Unmark broken.vtf' }).click();
  await expect(page.locator('#marked-list li')).toHaveCount(1);
  await page.locator('#unmark-all').click();
  await expect(page.locator('#marked-summary')).toHaveText('Nothing in this folder is marked.');
  await page.locator('#close-marked').click();
  await expect(page.locator('.spray-tile:visible')).toHaveCount(4);
  expect(errors).toEqual([]);
});

test('animated sprays play automatically in tiles and the viewer, and pause on scrub', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await page.locator('#folder-input').setInputFiles(folder);
  await expect(page.locator('#summary')).toHaveText('3 sprays / 1 unreadable');
  const tile = page.locator('.spray-tile[data-path="fixture-temp/nested/c-animated.vtf"]');
  await expect(tile.locator('canvas')).toHaveCount(1);
  await expect(tile.locator('img')).toBeHidden();
  // The frame shown by the tile canvas changes over time.
  const sample = () => tile.locator('canvas').evaluate(canvas => [...canvas.getContext('2d').getImageData(0, 0, 1, 1).data].join());
  const seen = new Set([await sample()]);
  await expect.poll(async () => { seen.add(await sample()); return seen.size; }, { timeout: 3000 }).toBe(2);
  await page.locator('#animate').uncheck();
  await expect(tile.locator('canvas')).toHaveCount(0);
  await expect(tile.locator('img')).toBeVisible();
  await page.locator('#animate').check();
  await expect(tile.locator('canvas')).toHaveCount(1);
  await page.getByRole('button', { name: 'View c-animated.vtf', exact: true }).click();
  await expect(page.locator('#full-animation')).toBeVisible();
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Pause animation');
  const frames = new Set();
  await expect.poll(async () => { frames.add(await page.locator('#frame-number').textContent()); return frames.size; }, { timeout: 3000 }).toBe(2);
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play animation');
  await expect(page.locator('#full-image')).toBeVisible();
  await page.locator('#play').click();
  await expect(page.locator('#full-animation')).toBeVisible();
  await page.locator('#frame').fill('0');
  await page.locator('#frame').dispatchEvent('change');
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play animation');
  await expect(page.locator('#frame-number')).toHaveText('1 / 2');
  await expect(page.locator('#full-image')).toBeVisible();
  await page.locator('#mark-viewer').click();
  await expect(page.locator('#mark-viewer')).toHaveText('Unmark');
  await expect(page.locator('#toast')).toBeVisible();
  await page.locator('#close-viewer').click();
  await expect(tile).toBeHidden();
  expect(errors).toEqual([]);
});

test('distance-fade sprays are badged, sortable and previewed level by level', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const dir = path.resolve('.local/fade-temp');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'fade.vtf'), new Uint8Array(await fadeFixture()));
  await writeFile(path.join(dir, 'plain.vtf'), new Uint8Array(await rgbaFixture({ mips: 3 })));
  await page.goto('./');
  await page.locator('#sort').selectOption('fading');
  await page.locator('#folder-input').setInputFiles(dir);
  await expect(page.locator('#summary')).toHaveText('2 sprays');
  await expect(page.locator('.tile-name')).toHaveText(['fade.vtf', 'plain.vtf']);
  await expect(page.locator('.frame-badge')).toHaveText(['Fades: 2 pictures']);
  await expect(page.locator('.fade-strip img')).toHaveCount(1);
  await page.getByRole('button', { name: 'Fade sprays first', exact: true }).waitFor();
  await page.getByRole('button', { name: 'View fade.vtf', exact: true }).click();
  await expect(page.locator('#distance-controls')).toBeVisible();
  await expect(page.locator('#distance-label')).toHaveText('Close (64 x 64)');
  await expect(page.locator('#viewer-meta')).toContainText('Distance fade: 2 pictures');
  await page.locator('#distance').fill('1');
  await expect(page.locator('#distance-label')).toHaveText('2x farther (32 x 32)');
  await expect.poll(() => page.locator('#full-image').evaluate(image => image.naturalWidth)).toBe(32);
  await expect(page.locator('#full-image')).toHaveClass(/distant/);
  const saved = page.waitForEvent('download');
  await page.locator('#download-image').click();
  expect((await saved).suggestedFilename()).toBe('fade-frame-1-distance-2x.png');
  await page.locator('#close-viewer').click();
  await page.getByRole('button', { name: 'View plain.vtf', exact: true }).click();
  await expect(page.locator('#distance-controls')).toBeHidden();
  await expect(page.locator('#full-image')).not.toHaveClass(/distant/);
  expect(errors).toEqual([]);
});

test('favorites are starred, named, validated, remembered and exported as an install script', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await page.locator('#folder-input').setInputFiles(folder);
  await expect(page.locator('#summary')).toHaveText('3 sprays / 1 unreadable');
  await expect(page.locator('#favorites')).toBeDisabled();
  await page.getByRole('button', { name: 'Favorite a-old.vtf' }).click();
  await expect(page.getByRole('button', { name: 'Favorite a-old.vtf' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'View c-animated.vtf', exact: true }).click();
  await page.locator('#favorite-viewer').click();
  await expect(page.locator('#favorite-viewer')).toHaveText('Unfavorite');
  await page.locator('#close-viewer').click();
  await expect(page.locator('#favorites-count')).toHaveText('2');
  await page.locator('#favorites').click();
  const names = page.locator('#favorites-list input');
  await expect(names).toHaveCount(2);
  await names.nth(1).fill('A-OLD');
  await expect(page.locator('.favorite-error').nth(1)).toContainText('Same name as');
  await expect(page.locator('#install-windows')).toBeDisabled();
  await names.nth(1).fill('Bad&Name');
  await expect(page.locator('.favorite-error').nth(1)).toContainText('Use letters');
  await names.nth(1).fill('Animated Spray');
  await expect(page.locator('#install-windows')).toBeEnabled();
  const script = page.waitForEvent('download');
  await page.locator('#install-windows').click();
  const download = await script;
  expect(download.suggestedFilename()).toBe('install-favorite-sprays.bat');
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString();
  const installs = text.split(/\r?\n/).filter(line => line.startsWith('call :install'));
  expect(installs.sort()).toEqual(['call :install "a-old.vtf" "a-old"', 'call :install "nested\\c-animated.vtf" "Animated Spray"']);
  await expect(page.locator('#favorites-status')).toContainText('fixture-temp');
  await page.locator('#close-favorites').click();
  // Names and stars survive a reload and re-import.
  await page.reload();
  await page.locator('#folder-input').setInputFiles(folder);
  await expect(page.locator('#favorites-count')).toHaveText('2');
  await page.locator('#favorites').click();
  await expect(page.locator('#favorites-list input').nth(1)).toHaveValue('Animated Spray');
  await page.getByRole('button', { name: 'Remove a-old.vtf from favorites' }).click();
  await expect(page.locator('#favorites-list li')).toHaveCount(1);
  await page.locator('#close-favorites').click();
  await expect(page.getByRole('button', { name: 'Favorite a-old.vtf' })).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('filtering and replacing a collection during fingerprinting cannot strand jobs or restore old tiles', async ({ page }) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...args) {
      if (message.kind === 'fingerprint') setTimeout(() => post.call(this, message, ...args), 200);
      else post.call(this, message, ...args);
    };
  });
  await page.goto('./');
  await page.locator('#folder-input').setInputFiles(folder);
  await expect(page.locator('#summary')).toContainText('Checking duplicates');
  await page.locator('#search').fill('b-new');
  await expect(page.locator('#summary')).toHaveText('3 sprays / 1 unreadable');
  await expect(page.locator('.spray-tile:visible')).toHaveCount(1);
  await page.locator('#search').fill('');
  await expect(page.locator('.spray-button img')).toHaveCount(3);
  await page.locator('#folder-input').setInputFiles(folder);
  await expect(page.locator('#summary')).toContainText('Checking duplicates');
  await page.locator('#clear').click();
  await page.locator('#file-input').setInputFiles(path.join(folder, 'a-old.vtf'));
  await expect(page.locator('#summary')).toHaveText('1 spray');
  await expect(page.locator('.spray-tile')).toHaveCount(1);
  await expect(page.locator('.tile-name')).toHaveText('a-old.vtf');
});
