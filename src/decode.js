import { Vtf, VFormats } from 'vtf-js';
import { inspectVtf } from './catalog.js';

const names = new Map(Object.entries(VFormats).map(([name, id]) => [id, name]));

export async function decodeVtf(buffer, { frame = 0, maxDimension = 256 } = {}) {
  const info = inspectVtf(buffer);
  const texture = await Vtf.decode(buffer, { onDemand: true, noClone: true });
  const mip = Math.min(info.mips - 1, Math.max(0, Math.ceil(Math.log2(Math.max(info.width, info.height) / maxDimension))));
  const image = texture.body.getImage(mip, Math.min(Math.max(frame, 0), info.frames - 1), 0, 0).coerce(Uint8Array);
  return { ...info, formatName: names.get(info.format) || String(info.format), imageWidth: image.width, imageHeight: image.height, pixels: image.data };
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
  while (mip < info.mips - 1 && !fits(Math.max(1, info.width >> mip), Math.max(1, info.height >> mip))) ++mip;
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
