import { decodeVtf } from './decode.js';
import { inspectVtf, MAX_FILE_BYTES } from './catalog.js';

self.onmessage = async ({ data: { id, file, frame, maxDimension } }) => {
  try {
    if (file.size > MAX_FILE_BYTES) throw new Error('VTF exceeds the 64 MB safety limit.');
    inspectVtf(await file.slice(0, 1024).arrayBuffer(), file.size);
    const result = await decodeVtf(await file.arrayBuffer(), { frame, maxDimension });
    self.postMessage({ id, result }, [result.pixels.buffer]);
  } catch (error) {
    self.postMessage({ id, error: error.message || 'Unable to decode this VTF.' });
  }
};
