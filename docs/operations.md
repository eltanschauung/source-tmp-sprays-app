# Development and deployment

Node.js 22.12+ (22 LTS recommended). Install pinned dependencies with `npm ci`.
Run `npm test`, `npm run build`, and `npm run test:browser`. The browser suite
uses installed Google Chrome; change Playwright's channel if using Chromium.
Run `npm run dev` for local development; Vite serves `/sprays/`.
Production is a static Vite build (`dist/`); no upload service or database.

The content security policy forbids fetch/XHR/WebSocket connections. Development
Vite HMR is consequently blocked; refresh the page after editing. Production
does not use HMR. All dependencies are bundled, with no external CDN requests.

The folder picker uses `webkitdirectory` and includes nested folders. The file
picker is a fallback for browsers/platforms without directory selection. Folder
and file drops are supported. Sorting uses local `File.lastModified` timestamps
(not creation time), byte size, filename, resolution, or animated status (more
than one frame). Animated sorting groups animations first by default; reversing
puts still images first. A copied folder can have
different timestamps. No operating-system absolute path is disclosed to the app.

Before decoding, the same bounded worker pool hashes each valid VTF with MD5,
treating only header-padding bytes 28-31 as zero. This ignores Enhanced Sprays'
IS14 stamp; the remaining bytes (including every frame/mipmap) are hashed as-is.
For matching hashes, only the file with the latest lastModified is displayed
and exported, regardless of display sorting. Equal timestamps use the relative
path alphabetically as a deterministic tiebreaker. Failed fingerprints retain
their individual decode/error path. The summary reports hidden duplicate counts.
Grouping is scoped to the current selection, resets on clear/re-import, and does
not alter/delete source files or persist hashes. It is exact normalized-file
deduplication, not perceptual similarity across recompressed/resized images.

Each tile has a "mark for deletion" checkbox (also in the viewer). Marked sprays
are hidden immediately (with Undo), left out of collage exports, and remembered
in localStorage by normalized hash, so they stay hidden on later imports and
when the same spray is downloaded again under another name; unreadable files
are remembered by path. "Show marked" reveals them for unmarking. The Marked
dialog lists every marked file, including hidden duplicate copies of a marked
spray, and offers a list copy and Windows (.bat) / POSIX (.sh) delete scripts.
Scripts use paths relative to the opened folder, must be placed in that folder,
refuse to run if none of the files are next to them, and ask before deleting.
The app itself still never modifies or deletes files.

VTF 7.0-7.6 decoding uses vtf-js, including DXT1/3/5 and supported raw formats.
The collage uses the first animation frame; individual viewers allow frame
selection and full-resolution PNG downloads. Animated sprays play automatically
at 5 fps (TF2's fixed spray rate) in tiles and the viewer; the "Animate" toggle
turns tile playback off, and it defaults off with prefers-reduced-motion. Tile
frames are decoded only for tiles near the viewport, downscaled to 256 px and a
2-megapixel frame sheet, kept as a compressed PNG, and their bitmaps released
when scrolled away. The viewer plays a sheet of up to 1024 px / 16 megapixels;
pausing or scrubbing switches back to the full-resolution frame for saving. Cube/volume textures, malformed or
unsupported formats, files over 64 MiB, excessive dimensions/frames, and decode
timeouts appear as per-file errors without stopping the remaining collection.
Two workers process bounded thumbnails, one selected full image is retained,
and object URLs/workers are cleaned up on collection changes. PNG collage
exports include the current filename filter and sort, use first-frame previews,
and are capped at 32 megapixels / 8192 pixels per edge to avoid canvas failures.

## kogasa.tf

The canonical source repository is `~/source-tmp-sprays-app`. Run `npm ci`,
`npm test`, `npm run build`, then `bash tools/deploy-kogasa.sh`. The deployment
copies only the static build into `~/Kogasatopia-Frontend/priv/static/sprays` and
the same directory in the active root-owned frontend release. The pre-existing
LegacyStatic directory-index handler serves `/sprays` (redirect) and `/sprays/`.
No PHP, new daemon, database migration, game reload, or frontend restart is needed.
Commit the generated `priv/static/sprays` files in Kogasatopia-Frontend so future
immutable frontend releases retain the app. Do not commit unrelated dirty files.

The deployment installs content-hashed assets first and index.html last.
Old hashed assets are retained so already-open clients finish loading correctly.
Only build assets are published, never node_modules, test fixtures, or local files.
Verify `/sprays/`, its worker JS, PNG export, and a folder import over public TLS.

The README intentionally contains only the requested title and description.
