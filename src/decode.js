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
