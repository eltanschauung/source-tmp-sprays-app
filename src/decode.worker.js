import { decodeVtf, decodeVtfFrames } from './decode.js';
import { inspectVtf, MAX_FILE_BYTES } from './catalog.js';
import { normalizedVtfMd5 } from './duplicates.js';

self.onmessage = async ({ data: { id, kind, file, frame, maxDimension, maxPixels, mip } }) => {
  try {
    if (file.size > MAX_FILE_BYTES) throw new Error('VTF exceeds the 64 MB safety limit.');
    inspectVtf(await file.slice(0, 1024).arrayBuffer(), file.size);
    const buffer = await file.arrayBuffer();
    if (kind === 'fingerprint') {
      self.postMessage({ id, result: { fingerprint: normalizedVtfMd5(buffer) } });
      return;
    }
    const result = kind === 'frames'
      ? await decodeVtfFrames(buffer, { maxDimension, maxPixels })
      : await decodeVtf(buffer, { frame, maxDimension, mip });
    self.postMessage({ id, result }, [result.pixels.buffer, ...(result.fadeImages || []).map(image => image.pixels.buffer)]);
  } catch (error) {
    self.postMessage({ id, error: error.message || 'Unable to decode this VTF.' });
  }
};
