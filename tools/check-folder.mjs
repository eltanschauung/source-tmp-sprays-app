import { readdir, readFile, open } from 'node:fs/promises';
import path from 'node:path';
import { inspectVtf } from '../src/catalog.js';
import { decodeVtf } from '../src/decode.js';

const folder = process.argv[2];
if (!folder) throw new Error('Pass a VTF directory.');
const stats = { headers: 0, decoded: 0, errors: {} };
const files = (await readdir(folder, { withFileTypes: true })).filter(file => file.isFile() && /\.vtf$/i.test(file.name));
for (let i = 0; i < files.length; i++) {
  const filename = path.join(folder, files[i].name);
  let handle;
  try {
    handle = await open(filename, 'r');
    const size = (await handle.stat()).size;
    const buffer = new Uint8Array(Math.min(size, 1024));
    await handle.read(buffer, 0, buffer.length, 0);
    inspectVtf(buffer.buffer, size);
    ++stats.headers;
    if (i % Math.max(1, Math.floor(files.length / 128)) === 0) {
      const data = await readFile(filename);
      await decodeVtf(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      ++stats.decoded;
    }
  } catch (error) {
    stats.errors[error.message] = (stats.errors[error.message] || 0) + 1;
  } finally {
    await handle?.close();
  }
}
console.log(JSON.stringify({ files: files.length, ...stats }, null, 2));
