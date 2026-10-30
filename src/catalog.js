export const MAX_FILE_BYTES = 64 * 1024 * 1024;

// Reject hostile dimensions before the third-party decoder allocates collections.
export function inspectVtf(buffer, fileSize = buffer.byteLength) {
  if (fileSize > MAX_FILE_BYTES) throw new Error('VTF exceeds the 64 MB safety limit.');
  if (buffer.byteLength < 63) throw new Error('Truncated VTF header.');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x00465456) throw new Error('Not a Valve Texture Format file.');
  const major = view.getUint32(4, true);
  const minor = view.getUint32(8, true);
  if (major !== 7 || minor > 6) throw new Error(`Unsupported VTF version ${major}.${minor}.`);
  const headerSize = view.getUint32(12, true);
  if (headerSize < (minor >= 2 ? 65 : 63) || headerSize > fileSize) throw new Error('Invalid VTF header size.');
  const width = view.getUint16(16, true);
  const height = view.getUint16(18, true);
  const flags = view.getUint32(20, true);
  const frames = view.getUint16(24, true);
  const format = view.getUint32(52, true);
  const mips = view.getUint8(56);
  if (!width || !height || width > 4096 || height > 4096) throw new Error('Invalid or excessive VTF dimensions (maximum 4096 x 4096).');
  if (!frames || frames > 8192 || width * height * frames > 64 * 1024 * 1024) throw new Error('Excessive VTF animation data.');
  if (!mips || mips > 13) throw new Error('Invalid VTF mipmap count.');
  if (flags & 0x4000) throw new Error('Cubemap textures are not sprays.');
  if (minor >= 2 && buffer.byteLength >= 65 && view.getUint16(63, true) > 1) throw new Error('Volume textures are not sprays.');
  if (minor >= 3) {
    if (buffer.byteLength < 80 || headerSize < 80) throw new Error('Truncated VTF resource header.');
    const resources = view.getUint32(68, true);
    if (resources > 64 || 80 + resources * 8 > headerSize) throw new Error('Invalid VTF resource table.');
  }
  return { width, height, frames, format, mips, version: `7.${minor}` };
}

export function sortEntries(entries, sort = 'date', descending = true, query = '') {
  const needle = query.trim().toLowerCase();
  const sign = descending ? -1 : 1;
  return entries.filter(entry => !needle || entry.path.toLowerCase().includes(needle)).sort((a, b) => {
    let order = 0;
    if (sort === 'name') order = a.path.localeCompare(b.path, undefined, { numeric: true });
    else if (sort === 'size') order = a.file.size - b.file.size;
    else if (sort === 'dimensions') order = (a.width || 0) * (a.height || 0) - (b.width || 0) * (b.height || 0);
    else if (sort === 'animated') order = Number(a.frames > 1) - Number(b.frames > 1);
    else order = a.file.lastModified - b.file.lastModified;
    return order * sign || a.path.localeCompare(b.path, undefined, { numeric: true });
  });
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function exportLayout(count, columns = 6) {
  if (!count) throw new Error('No decoded sprays to export.');
  columns = Math.max(1, Math.min(columns, count));
  if (Math.ceil(count / columns) > 128) columns = Math.max(columns, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);
  const cell = Math.floor(Math.min(256, 8192 / columns, 8192 / rows, Math.sqrt(32_000_000 / (columns * rows))));
  if (cell < 16) throw new Error('Too many images for one PNG; narrow the filename search first.');
  return { columns, rows, cell, width: columns * cell, height: rows * cell };
}
