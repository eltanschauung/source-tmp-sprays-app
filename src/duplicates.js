import { md5 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { inspectVtf } from './catalog.js';

const HEADER_PADDING = new Uint8Array(4);

export function normalizedVtfMd5(buffer) {
  inspectVtf(buffer);
  const bytes = new Uint8Array(buffer);
  // Enhanced Sprays stamps IS14 in this padding. Hash zeros in its place,
  // without copying or changing any image, animation, or source-file bytes.
  return bytesToHex(md5.create()
    .update(bytes.subarray(0, 28))
    .update(HEADER_PADDING)
    .update(bytes.subarray(32))
    .digest());
}

export function deduplicateEntries(entries) {
  const newest = new Map();
  for (const entry of entries) {
    if (!entry.fingerprint) continue;
    const previous = newest.get(entry.fingerprint);
    if (!previous || entry.file.lastModified > previous.file.lastModified
      || (entry.file.lastModified === previous.file.lastModified && entry.path.localeCompare(previous.path) < 0)) {
      newest.set(entry.fingerprint, entry);
    }
  }
  // Invalid/unreadable files have no fingerprint and keep their individual errors.
  const unique = entries.filter(entry => !entry.fingerprint || newest.get(entry.fingerprint) === entry);
  return { entries: unique, duplicates: entries.length - unique.length };
}
