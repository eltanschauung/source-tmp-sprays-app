import { Vtf, VFormats } from 'vtf-js';
import { inspectVtf } from './catalog.js';

const names = new Map(Object.entries(VFormats).map(([name, id]) => [id, name]));

// Mean per-channel difference (0-255) between coarse block averages above
// which a mipmap is a different picture rather than a shrunken copy. Smaller
// levels drift more through compression and resampling, so they need more.
// Calibrated on ~5,900 real TF2 sprays: about 3% are flagged.
const fadeThreshold = edge => edge >= 128 ? 10 : edge >= 64 ? 14 : 18;
const FADE_GRID = 16;
const FADE_MIN_EDGE = 32;
const FADE_MAX_EDGE = 1024;
const MAX_FADE_PREVIEWS = 3;

// Block-averages an image to a size x size RGB grid, composited over mid-gray.
function blockAverages({ data, width, height }, size) {
  const out = new Float64Array(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const x0 = Math.floor(x * width / size), x1 = Math.max(x0 + 1, Math.floor((x + 1) * width / size));
    const y0 = Math.floor(y * height / size), y1 = Math.max(y0 + 1, Math.floor((y + 1) * height / size));
    let r = 0, g = 0, b = 0, n = 0;
    for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
      const i = (sy * width + sx) * 4, a = data[i + 3] / 255;
      r += data[i] * a + 128 * (1 - a); g += data[i + 1] * a + 128 * (1 - a); b += data[i + 2] * a + 128 * (1 - a); ++n;
    }
    out.set([r / n, g / n, b / n], (y * size + x) * 3);
  }
  return out;
}

// Coarse comparison: compression noise and resampling filters differ pixel by
// pixel even in ordinary sprays, but agree once averaged into blocks.
function mipDifference(upper, lower) {
  // At least 4x4 pixels per block, or per-pixel noise dominates again.
  const size = Math.min(FADE_GRID, Math.floor(Math.min(lower.width, lower.height) / 4));
  const a = blockAverages(upper, size);
  const b = blockAverages(lower, size);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

// Distance-fade sprays store a different picture in some mipmaps, so the game
// shows another image as the spray gets farther away. Returns the mip levels
// that start a new picture (empty for ordinary sprays).
export function fadeLevels(texture, info) {
  const levels = [];
  let upper = null;
  for (let mip = 0; mip < info.mips; mip++) {
    const width = Math.max(1, info.width >> mip);
    const height = Math.max(1, info.height >> mip);
    if (Math.min(width, height) < FADE_MIN_EDGE) break;
    if (Math.max(width, height) > FADE_MAX_EDGE) continue;
    const image = texture.body.getImage(mip, 0, 0, 0).coerce(Uint8Array);
    if (upper && mipDifference(upper, image) > fadeThreshold(Math.min(width, height))) levels.push(mip);
    upper = image;
  }
  return levels;
}

export async function decodeVtf(buffer, { frame = 0, maxDimension = 256, mip: level = null } = {}) {
  const info = inspectVtf(buffer);
  const texture = await Vtf.decode(buffer, { onDemand: true, noClone: true });
  const fades = fadeLevels(texture, info);
  // Fade sprays always preview their closest picture; smaller mips are other images.
  const mip = level !== null ? Math.min(info.mips - 1, Math.max(0, level))
    : fades.length ? 0
      : Math.min(info.mips - 1, Math.max(0, Math.ceil(Math.log2(Math.max(info.width, info.height) / maxDimension))));
  const image = texture.body.getImage(mip, Math.min(Math.max(frame, 0), info.frames - 1), 0, 0).coerce(Uint8Array);
  // Gallery previews also get the farther pictures, so hidden ones are visible at a glance.
  const fadeImages = level === null ? fades.slice(0, MAX_FADE_PREVIEWS).map(fadeMip => {
    const far = texture.body.getImage(fadeMip, 0, 0, 0).coerce(Uint8Array);
    return { mip: fadeMip, imageWidth: far.width, imageHeight: far.height, pixels: far.data };
  }) : [];
  return { ...info, fades, fadeImages, mip, formatName: names.get(info.format) || String(info.format), imageWidth: image.width, imageHeight: image.height, pixels: image.data };
}

// Alpha-weighted 2x2 average, so transparent pixels do not darken the edges.
function halve({ data, width, height }) {
  const w = Math.max(1, width >> 1);
  const h = Math.max(1, height >> 1);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const sx = Math.min(width - 1, x * 2 + dx);
      const sy = Math.min(height - 1, y * 2 + dy);
      const i = (sy * width + sx) * 4;
      r += data[i] * data[i + 3]; g += data[i + 1] * data[i + 3]; b += data[i + 2] * data[i + 3]; a += data[i + 3]; ++n;
    }
    const o = (y * w + x) * 4;
    if (a) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
    out[o + 3] = a / n;
  }
  return { data: out, width: w, height: h };
}

// Decodes every animation frame into one packed RGBA buffer, shrinking frames
// until they fit both maxDimension and the total maxPixels budget.
export async function decodeVtfFrames(buffer, { maxDimension = 256, maxPixels = 2 ** 21 } = {}) {
  const info = inspectVtf(buffer);
  const texture = await Vtf.decode(buffer, { onDemand: true, noClone: true });
  const fits = (width, height) => Math.max(width, height) <= maxDimension && width * height * info.frames <= maxPixels;
  let mip = 0;
  // Fade sprays' smaller mips are other pictures, so shrink the closest one instead.
  const fading = fadeLevels(texture, info).length > 0;
  while (!fading && mip < info.mips - 1 && !fits(Math.max(1, info.width >> mip), Math.max(1, info.height >> mip))) ++mip;
  let pixels = null;
  let frameWidth = 0;
  let frameHeight = 0;
  for (let frame = 0; frame < info.frames; frame++) {
    let image = texture.body.getImage(mip, frame, 0, 0).coerce(Uint8Array);
    image = { data: image.data, width: image.width, height: image.height };
    while (!fits(image.width, image.height) && (image.width > 1 || image.height > 1)) image = halve(image);
    if (!pixels) {
      frameWidth = image.width;
      frameHeight = image.height;
      pixels = new Uint8Array(frameWidth * frameHeight * 4 * info.frames);
    }
    pixels.set(image.data.subarray(0, frameWidth * frameHeight * 4), frame * frameWidth * frameHeight * 4);
  }
  return { ...info, formatName: names.get(info.format) || String(info.format), frameWidth, frameHeight, pixels };
}
