import { Vtf, VCollection, VImageData, VFormats } from 'vtf-js';

export async function rgbaFixture({ width = 64, height = 64, version = 3, frames = 1, color = [220, 60, 80, 255], mips = 1 } = {}) {
  const images = Array.from({ length: frames }, (_, frame) => {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const grid = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
      data.set(frame ? [30, 180, 240, 255] : grid ? color : [30, 40, 35, 255], index);
    }
    return new VImageData(data, width, height);
  });
  const body = VCollection.fromFrames(images, { mips });
  if (mips > 1) body.generateMips();
  return new Vtf(body, { version, format: VFormats.RGBA8888 }).encode();
}

export function dxtFixture(format = 13, frames = 1) {
  const frameBytes = format === 13 ? 8 : 16;
  const bytes = new Uint8Array(80 + frames * frameBytes);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00465456, true);
  view.setUint32(4, 7, true);
  view.setUint32(8, 2, true);
  view.setUint32(12, 80, true);
  view.setUint16(16, 4, true);
  view.setUint16(18, 4, true);
  view.setUint16(24, frames, true);
  view.setUint32(52, format, true);
  bytes[56] = 1;
  view.setUint32(57, 0xffffffff, true);
  view.setUint16(63, 1, true);
  for (let frame = 0; frame < frames; frame++) {
    const start = 80 + frame * frameBytes;
    if (format === 14) bytes.fill(255, start, start + 8);
    if (format === 15) { bytes[start] = 255; bytes[start + 1] = 0; }
    const colorOffset = format === 13 ? start : start + 8;
    view.setUint16(colorOffset, 0xf800, true);
    view.setUint16(colorOffset + 2, 0x07e0, true);
  }
  return bytes.buffer;
}
