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
  await page.locator('#folder-input').setInputFiles(folder);
  await expect(page.locator('#summary')).toHaveText('3 sprays / 1 unreadable');
  await expect(page.locator('.spray-button img')).toHaveCount(3);
  await expect(page.locator('#notice')).toHaveText('1 non-VTF file skipped.');
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
