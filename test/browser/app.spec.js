import { test, expect } from '@playwright/test';
import { rgbaFixture, dxtFixture } from '../fixtures.js';
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
  await page.locator('#clear').click();
  await expect(page.locator('#summary')).toHaveText('No folder selected');
  await page.locator('#file-input').setInputFiles(path.join(dir, 'old-stamped.vtf'));
  await expect(page.locator('#summary')).toHaveText('1 spray');
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
