import { createIcons, GalleryVerticalEnd, ShieldCheck, CodeXml, Download, FolderOpen, FilePlus2, Search, ArrowDownWideNarrow, ArrowUpNarrowWide, Grid2x2, Trash2, FolderPlus, FolderDown, X, ListX, Play, Pause } from 'lucide';
import { formatBytes, sortEntries, exportLayout } from './catalog.js';
import { DecoderPool } from './pool.js';
import { deduplicateEntries } from './duplicates.js';
import { markKey, loadMarks, saveMarks, relativePath, batchScript, shellScript } from './marks.js';
import { Animator, SheetPlayer, sheetCanvas } from './animation.js';
import './style.css';

const icons = { GalleryVerticalEnd, ShieldCheck, CodeXml, Download, FolderOpen, FilePlus2, Search, ArrowDownWideNarrow, ArrowUpNarrowWide, Grid2x2, Trash2, FolderPlus, FolderDown, X, ListX, Play, Pause };
const $ = id => document.getElementById(id);
const refreshIcons = () => createIcons({ icons });
const storage = (() => { try { return window.localStorage; } catch { return null; } })();
// Frame sheets are capped so many visible animations stay within a modest memory budget.
const TILE_SHEET = { maxDimension: 256, maxPixels: 2 ** 21 };
const VIEWER_SHEET = { maxDimension: 1024, maxPixels: 2 ** 24 };
const state = { entries: [], allEntries: [], root: '', generation: 0, descending: true, pool: null, completed: 0, ready: 0, failed: 0, bytes: 0, viewerToken: 0, viewerSession: 0, fullUrl: null, selected: null, viewerLoading: false, refreshPending: false, checkingDuplicates: false, fingerprinted: 0, duplicates: 0, marks: loadMarks(storage), showMarked: false, animate: !matchMedia('(prefers-reduced-motion: reduce)').matches, viewerPlaying: false, viewerPlayer: null, viewerSheet: null };
const animator = new Animator();
const tileEntries = new WeakMap();
const tileObserver = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(records => {
  for (const { target, isIntersecting } of records) {
    const entry = tileEntries.get(target);
    if (!entry) continue;
    entry.onScreen = isIntersecting;
    updateTileAnimation(entry);
  }
}, { rootMargin: '200px' });
const dateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
$('animate').checked = state.animate;
refreshIcons();

function notice(message = '', action = null) {
  $('notice').textContent = message;
  if (action) {
    const button = document.createElement('button');
    button.textContent = action.label;
    button.addEventListener('click', () => { notice(); action.run(); });
    $('notice').append(button);
  }
  $('notice').hidden = !message;
}

const isMarked = entry => state.marks.has(markKey(entry));
// Includes hidden duplicate copies, which share the marked spray's hash.
const markedFiles = () => state.allEntries.filter(isMarked);

function visibleEntries() {
  return sortEntries(state.showMarked ? state.entries : state.entries.filter(entry => !isMarked(entry)), $('sort').value, state.descending, $('search').value);
}

function exportEntries() {
  return visibleEntries().filter(entry => entry.url && !isMarked(entry));
}

function updateSummary() {
  const { ready, failed } = state;
  const count = state.entries.length;
  const marked = state.entries.filter(isMarked).length;
  const pending = state.checkingDuplicates || state.completed < count;
  $('summary').textContent = state.checkingDuplicates
    ? `${state.fingerprinted.toLocaleString()} / ${count.toLocaleString()} files / Checking duplicates`
    : count ? `${ready.toLocaleString()} ${ready === 1 ? 'spray' : 'sprays'}${pending ? ` / ${count.toLocaleString()} files` : ''}${failed ? ` / ${failed.toLocaleString()} unreadable` : ''}${state.duplicates ? ` / ${state.duplicates.toLocaleString()} duplicates hidden` : ''}${marked ? ` / ${marked.toLocaleString()} marked` : ''}${pending ? ' / Processing' : ''}` : 'No folder selected';
  $('footer-count').textContent = `${count.toLocaleString()} VTF files`;
  $('footer-size').textContent = formatBytes(state.bytes);
  $('progress').style.width = count && pending
    ? `${state.checkingDuplicates ? state.fingerprinted / count * 50 : 50 + state.completed / count * 50}%` : '0';
  $('export').disabled = pending || !exportEntries().length;
  $('clear').disabled = !count;
  $('marked-count').textContent = marked.toLocaleString();
  $('marked').disabled = state.checkingDuplicates || !marked;
}

function scheduleRefresh() {
  if (state.refreshPending) return;
  state.refreshPending = true;
  setTimeout(() => {
    state.refreshPending = false;
    if (['dimensions', 'animated'].includes($('sort').value)) renderOrder();
    else updateSummary();
  }, 100);
}

function renderOrder() {
  if (state.checkingDuplicates) {
    $('empty').hidden = true;
    $('gallery').hidden = true;
    $('no-results').hidden = true;
    updateSummary();
    return;
  }
  const ordered = visibleEntries();
  const visible = new Set(ordered);
  for (const entry of state.entries) {
    const marked = isMarked(entry);
    entry.tile.hidden = !visible.has(entry);
    entry.tile.classList.toggle('marked', marked);
    entry.mark.checked = marked;
  }
  // Move existing nodes instead of recreating decoded images when sorting.
  const fragment = document.createDocumentFragment();
  for (const entry of ordered) fragment.append(entry.tile);
  $('gallery').append(fragment);
  $('empty').hidden = state.entries.length > 0;
  $('gallery').hidden = state.entries.length === 0;
  $('no-results').hidden = state.entries.length === 0 || ordered.length > 0;
  updateSummary();
}

function setMarked(entry, marked) {
  const key = markKey(entry);
  if (marked) state.marks.add(key);
  else state.marks.delete(key);
  saveMarks(storage, state.marks);
  renderOrder();
  if (state.selected === entry) updateViewerMark();
  if (marked && !state.showMarked) notice(`${entry.file.name} marked for deletion and hidden.`, { label: 'Undo', run: () => setMarked(entry, false) });
  else notice();
}

function tileFor(entry) {
  const tile = document.createElement('article');
  tile.className = 'spray-tile';
  tile.dataset.path = entry.path;
  const markLabel = document.createElement('label');
  markLabel.className = 'mark-control';
  markLabel.title = 'Mark for deletion';
  const mark = document.createElement('input');
  mark.type = 'checkbox';
  mark.setAttribute('aria-label', `Mark ${entry.file.name} for deletion`);
  mark.addEventListener('change', () => setMarked(entry, mark.checked));
  markLabel.append(mark);
  const button = document.createElement('button');
  button.className = 'spray-button';
  button.disabled = true;
  button.title = entry.path;
  button.setAttribute('aria-label', `View ${entry.file.name}`);
  const loading = document.createElement('span');
  loading.className = 'tile-status';
  loading.textContent = 'Decoding';
  button.append(loading);
  button.addEventListener('click', () => openViewer(entry));
  const info = document.createElement('div');
  info.className = 'tile-info';
  const name = document.createElement('span');
  name.className = 'tile-name';
  name.textContent = entry.file.name;
  name.title = entry.path;
  const meta = document.createElement('div');
  meta.className = 'tile-meta';
  const date = document.createElement('span');
  date.textContent = entry.file.lastModified ? dateFormat.format(entry.file.lastModified) : 'Unknown date';
  const size = document.createElement('span');
  size.textContent = formatBytes(entry.file.size);
  meta.append(date, size);
  info.append(name, meta);
  tile.append(markLabel, button, info);
  entry.button = button;
  entry.mark = mark;
  entry.tile = tile;
  tileEntries.set(tile, entry);
  return tile;
}

async function canvasFrom(result, maxDimension) {
  const canvas = document.createElement('canvas');
  canvas.width = result.imageWidth;
  canvas.height = result.imageHeight;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(result.pixels.buffer, result.pixels.byteOffset, result.pixels.byteLength), canvas.width, canvas.height), 0, 0);
  if (Math.max(canvas.width, canvas.height) <= maxDimension) return canvas;
  const scaled = document.createElement('canvas');
  const ratio = maxDimension / Math.max(canvas.width, canvas.height);
  scaled.width = Math.max(1, Math.round(canvas.width * ratio));
  scaled.height = Math.max(1, Math.round(canvas.height * ratio));
  scaled.getContext('2d').drawImage(canvas, 0, 0, scaled.width, scaled.height);
  canvas.width = canvas.height = 0;
  return scaled;
}

function toBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to create image.')), 'image/png'));
}

function updateTileAnimation(entry) {
  if (state.animate && entry.onScreen && entry.frames > 1) void startTileAnimation(entry);
  else stopTileAnimation(entry);
}

// Frames are decoded only while a tile is near the viewport; the compressed
// sheet is kept, and its decoded bitmap is released when the tile scrolls away.
async function startTileAnimation(entry) {
  if (entry.player || entry.sheetFailed || entry.starting) return;
  entry.starting = true;
  const generation = state.generation;
  try {
    if (!entry.sheet) {
      const result = await state.pool.frames(entry.file, TILE_SHEET);
      const canvas = sheetCanvas(result);
      entry.sheet = { blob: await toBlob(canvas), frameWidth: result.frameWidth, frameHeight: result.frameHeight, frames: result.frames };
      canvas.width = canvas.height = 0;
    }
    const bitmap = await createImageBitmap(entry.sheet.blob);
    if (generation !== state.generation || !state.animate || !entry.onScreen) {
      bitmap.close();
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    entry.player = new SheetPlayer(canvas, bitmap, entry.sheet);
    entry.button.querySelector('img').hidden = true;
    entry.button.prepend(canvas);
    animator.add(entry.player);
  } catch {
    // Keep the still first frame if the animation cannot be decoded.
    entry.sheetFailed = true;
  } finally {
    entry.starting = false;
  }
}

function stopTileAnimation(entry) {
  const player = entry.player;
  if (!player) return;
  entry.player = null;
  animator.delete(player);
  player.source.close();
  player.canvas.remove();
  entry.button.querySelector('img').hidden = false;
}

function closeViewer() {
  ++state.viewerToken;
  ++state.viewerSession;
  stopViewerAnimation();
  if (state.viewerSheet) state.viewerSheet.canvas.width = state.viewerSheet.canvas.height = 0;
  state.viewerSheet = state.viewerPlayer = null;
  state.viewerLoading = false;
  $('full-animation').hidden = true;
  $('full-image').hidden = false;
  if (state.fullUrl) URL.revokeObjectURL(state.fullUrl);
  state.fullUrl = null;
  state.selected = null;
  $('full-image').removeAttribute('src');
  if ($('viewer').open) $('viewer').close();
}

function reset() {
  ++state.generation;
  state.pool?.close();
  state.pool = null;
  closeViewer();
  tileObserver?.disconnect();
  for (const entry of state.entries) stopTileAnimation(entry);
  animator.clear();
  for (const entry of state.entries) if (entry.url) URL.revokeObjectURL(entry.url);
  state.entries = [];
  state.allEntries = [];
  state.root = '';
  state.completed = 0;
  state.ready = state.failed = state.bytes = 0;
  state.checkingDuplicates = false;
  state.fingerprinted = state.duplicates = 0;
  $('gallery').replaceChildren();
  $('collection-name').textContent = 'Spray collection';
  $('folder-input').value = '';
  $('file-input').value = '';
  $('search').value = '';
  notice();
  renderOrder();
}

async function decodeEntry(entry, generation, pool) {
  try {
    const result = await pool.decode(entry.file);
    const canvas = await canvasFrom(result, 256);
    const blob = await toBlob(canvas);
    canvas.width = canvas.height = 0;
    if (generation !== state.generation) return;
    Object.assign(entry, { width: result.width, height: result.height, frames: result.frames, formatName: result.formatName, url: URL.createObjectURL(blob) });
    ++state.ready;
    const image = document.createElement('img');
    image.src = entry.url;
    image.alt = entry.file.name;
    image.loading = 'lazy';
    image.decoding = 'async';
    entry.button.replaceChildren(image);
    entry.button.disabled = false;
    if (entry.frames > 1) {
      const badge = document.createElement('span');
      badge.className = 'frame-badge';
      badge.textContent = `${entry.frames} frames`;
      entry.button.append(badge);
      tileObserver?.observe(entry.tile);
    }
  } catch (error) {
    if (generation !== state.generation) return;
    entry.error = error.message;
    ++state.failed;
    entry.button.classList.add('error');
    entry.button.title = `${entry.path}: ${error.message}`;
    entry.button.firstChild.textContent = error.message;
  } finally {
    if (generation === state.generation) {
      ++state.completed;
      scheduleRefresh();
    }
  }
}

async function loadFiles(items, label) {
  reset();
  const candidates = items.filter(({ file }) => /\.vtf$/i.test(file.name));
  if (!candidates.length) {
    notice('No .vtf files found in this selection.');
    return;
  }
  if (typeof Worker === 'undefined') {
    notice('This browser does not support background workers. Use a current desktop browser.');
    return;
  }
  state.entries = candidates.map(item => ({ ...item, url: null, error: null }));
  state.root = label || '';
  state.bytes = candidates.reduce((sum, entry) => sum + entry.file.size, 0);
  $('collection-name').textContent = label || 'Spray collection';
  const pool = state.pool = new DecoderPool();
  const generation = state.generation;
  state.checkingDuplicates = true;
  renderOrder();
  const skipped = items.length - candidates.length;
  if (skipped) notice(`${skipped.toLocaleString()} non-VTF ${skipped === 1 ? 'file' : 'files'} skipped.`);
  // Finish grouping before decoding/displaying anything. Worker completion order
  // and the selected display sort must never decide which copy survives.
  await Promise.all(state.entries.map(async entry => {
    try {
      const { fingerprint } = await pool.fingerprint(entry.file);
      entry.fingerprint = fingerprint;
    } catch {
      // Let the normal decode path show a file-specific error; never hide it.
    } finally {
      if (generation === state.generation) {
        ++state.fingerprinted;
        scheduleRefresh();
      }
    }
  }));
  if (generation !== state.generation) return;
  state.allEntries = state.entries;
  const deduplicated = deduplicateEntries(state.entries);
  state.entries = deduplicated.entries;
  state.duplicates = deduplicated.duplicates;
  state.bytes = state.entries.reduce((sum, entry) => sum + entry.file.size, 0);
  state.checkingDuplicates = false;
  const fragment = document.createDocumentFragment();
  for (const entry of state.entries) fragment.append(tileFor(entry));
  $('gallery').append(fragment);
  renderOrder();
  const hidden = state.entries.filter(isMarked).length;
  if (hidden && !state.showMarked) notice(`${hidden.toLocaleString()} previously marked ${hidden === 1 ? 'spray is' : 'sprays are'} hidden.`, { label: 'Show marked', run: () => { $('show-marked').checked = true; setShowMarked(true); } });
  for (const entry of sortEntries(state.entries, $('sort').value, state.descending)) void decodeEntry(entry, generation, pool);
}

async function showFrame() {
  const entry = state.selected;
  if (!entry || !state.pool) return;
  const token = ++state.viewerToken;
  $('download-image').disabled = true;
  $('frame-number').textContent = `${Number($('frame').value) + 1} / ${entry.frames}`;
  try {
    const result = await state.pool.decode(entry.file, { frame: Number($('frame').value), maxDimension: 4096 }, true);
    const canvas = await canvasFrom(result, 4096);
    const blob = await toBlob(canvas);
    canvas.width = canvas.height = 0;
    if (token !== state.viewerToken) return;
    if (state.fullUrl) URL.revokeObjectURL(state.fullUrl);
    state.fullUrl = URL.createObjectURL(blob);
    $('full-image').src = state.fullUrl;
    // Swap the preview animation for the full-resolution still once it is ready.
    if (!state.viewerPlaying) {
      $('full-animation').hidden = true;
      $('full-image').hidden = false;
    }
    $('download-image').disabled = false;
  } catch (error) {
    if (token === state.viewerToken) $('viewer-meta').textContent = error.message;
  }
}

function updatePlayButton() {
  const label = state.viewerPlaying ? 'Pause animation' : 'Play animation';
  $('play').title = label;
  $('play').setAttribute('aria-label', label);
  $('play').innerHTML = `<i data-lucide="${state.viewerPlaying ? 'pause' : 'play'}"></i>`;
  refreshIcons();
}

function showViewerFrame(frame) {
  $('frame').value = String(frame);
  $('frame-number').textContent = `${frame + 1} / ${state.selected.frames}`;
}

async function playViewer() {
  const entry = state.selected;
  if (!entry || entry.frames <= 1 || !state.pool) return;
  const session = state.viewerSession;
  state.viewerPlaying = true;
  updatePlayButton();
  if (!state.viewerSheet) {
    // A second press while frames load only flips viewerPlaying back on.
    if (state.viewerLoading) return;
    state.viewerLoading = true;
    try {
      const result = await state.pool.frames(entry.file, VIEWER_SHEET, true);
      if (session !== state.viewerSession) return;
      state.viewerSheet = { canvas: sheetCanvas(result), frameWidth: result.frameWidth, frameHeight: result.frameHeight, frames: result.frames };
      state.viewerPlayer = new SheetPlayer($('full-animation'), state.viewerSheet.canvas, state.viewerSheet, showViewerFrame);
    } catch {
      if (session !== state.viewerSession) return;
      state.viewerPlaying = false;
      updatePlayButton();
      return;
    } finally {
      if (session === state.viewerSession) state.viewerLoading = false;
    }
    if (!state.viewerPlaying) return;
  }
  state.viewerPlayer.restart(Number($('frame').value));
  state.viewerPlayer.current = -1;
  animator.add(state.viewerPlayer);
  $('full-animation').hidden = false;
  $('full-image').hidden = true;
}

function stopViewerAnimation() {
  state.viewerPlaying = false;
  if (state.viewerPlayer) animator.delete(state.viewerPlayer);
  updatePlayButton();
}

function pauseViewer() {
  stopViewerAnimation();
  return showFrame();
}

function updateViewerMark() {
  const marked = isMarked(state.selected);
  $('mark-viewer').setAttribute('aria-pressed', String(marked));
  $('mark-viewer').querySelector('span').textContent = marked ? 'Unmark' : 'Mark for deletion';
}

function openViewer(entry) {
  closeViewer();
  state.selected = entry;
  $('viewer-name').textContent = entry.file.name;
  $('full-image').alt = entry.file.name;
  $('full-image').src = entry.url;
  $('viewer-meta').textContent = `${entry.width} x ${entry.height} / ${entry.formatName} / ${formatBytes(entry.file.size)} / ${entry.file.lastModified ? new Date(entry.file.lastModified).toLocaleString() : 'Unknown date'}`;
  $('frame').max = String(entry.frames - 1);
  $('frame').value = '0';
  $('frame-controls').hidden = entry.frames <= 1;
  updateViewerMark();
  $('viewer').showModal();
  void showFrame();
  if (state.animate && entry.frames > 1) void playViewer();
}

function download(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

function downloadText(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  download(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const markedPaths = () => markedFiles().map(entry => relativePath(entry.path, state.root));

function renderMarked() {
  const files = markedFiles();
  const copies = files.filter(entry => !entry.tile).length;
  const folder = state.root ? `"${state.root}"` : 'the folder holding these files';
  $('marked-summary').textContent = files.length
    ? `${files.length.toLocaleString()} ${files.length === 1 ? 'file' : 'files'}${copies ? ` (including ${copies.toLocaleString()} hidden duplicate ${copies === 1 ? 'copy' : 'copies'})` : ''}. Browsers cannot delete files, so download a script, move it into ${folder} and run it. It asks before deleting anything.`
    : 'Nothing in this folder is marked.';
  const list = document.createDocumentFragment();
  for (const entry of files) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = relativePath(entry.path, state.root);
    name.title = entry.path;
    item.append(name);
    if (!entry.tile) {
      const note = document.createElement('small');
      note.textContent = 'duplicate';
      item.append(note);
    }
    const unmark = document.createElement('button');
    unmark.textContent = 'Unmark';
    unmark.setAttribute('aria-label', `Unmark ${entry.file.name}`);
    unmark.addEventListener('click', () => { setMarked(entry, false); renderMarked(); });
    item.append(unmark);
    list.append(item);
  }
  $('marked-list').replaceChildren(list);
  $('marked-list').hidden = !files.length;
  for (const id of ['script-windows', 'script-unix', 'copy-marked', 'unmark-all']) $(id).disabled = !files.length;
}

function setShowMarked(show) {
  state.showMarked = show;
  notice();
  renderOrder();
}

async function exportCollage() {
  const entries = exportEntries();
  const generation = state.generation;
  $('export').disabled = true;
  notice('Creating collage...');
  try {
    const columns = Math.max(1, Math.round($('gallery').clientWidth / (Number($('tile-size').value) + 14)));
    const layout = exportLayout(entries.length, columns);
    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#202321';
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < entries.length; i++) {
      if (generation !== state.generation) throw new Error('Export cancelled.');
      const image = new Image();
      image.src = entries[i].url;
      await image.decode();
      const size = layout.cell - 8;
      const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(image, (i % layout.columns) * layout.cell + (layout.cell - width) / 2, Math.floor(i / layout.columns) * layout.cell + (layout.cell - height) / 2, width, height);
      if (i % 40 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    const blob = await toBlob(canvas);
    canvas.width = canvas.height = 0;
    if (generation !== state.generation) return;
    const url = URL.createObjectURL(blob);
    download(url, 'source-sprays-collage.png');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    notice();
  } catch (error) {
    if (generation === state.generation) notice(error.message);
  } finally {
    updateSummary();
  }
}

async function collectDropItems(dataTransfer) {
  const items = [];
  async function visit(entry, prefix = '') {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      items.push({ file, path: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        for (const child of batch) await visit(child, `${prefix}${entry.name}/`);
      } while (batch.length);
    }
  }
  // Capture entries synchronously: DataTransfer is protected after the event returns.
  const entries = [...dataTransfer.items].map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  const files = [...dataTransfer.files];
  if (entries.length) for (const entry of entries) await visit(entry);
  else for (const file of files) items.push({ file, path: file.name });
  return items;
}

for (const id of ['open-folder', 'empty-open']) $(id).addEventListener('click', () => $('folder-input').click());
$('open-files').addEventListener('click', () => $('file-input').click());
for (const id of ['folder-input', 'file-input']) $(id).addEventListener('change', event => {
  const files = [...event.target.files];
  if (files.length) loadFiles(files.map(file => ({ file, path: file.webkitRelativePath || file.name })), files[0].webkitRelativePath?.split('/')[0]);
});
$('search').addEventListener('input', renderOrder);
$('sort').addEventListener('change', () => { updateDirection(); renderOrder(); });
$('direction').addEventListener('click', () => { state.descending = !state.descending; updateDirection(); renderOrder(); });
function updateDirection() {
  const descriptions = { date: ['Oldest first', 'Newest first'], size: ['Smallest first', 'Largest first'], name: ['A to Z', 'Z to A'], dimensions: ['Lowest resolution first', 'Highest resolution first'], animated: ['Still images first', 'Animated first'] };
  const label = descriptions[$('sort').value][Number(state.descending)];
  $('direction').title = label;
  $('direction').setAttribute('aria-label', label);
  $('direction').innerHTML = `<i data-lucide="${state.descending ? 'arrow-down-wide-narrow' : 'arrow-up-narrow-wide'}"></i>`;
  refreshIcons();
}
$('tile-size').addEventListener('input', () => document.documentElement.style.setProperty('--tile', `${$('tile-size').value}px`));
$('labels').addEventListener('change', () => $('gallery').classList.toggle('hide-labels', !$('labels').checked));
$('animate').addEventListener('change', () => { state.animate = $('animate').checked; for (const entry of state.entries) updateTileAnimation(entry); });
$('show-marked').addEventListener('change', () => setShowMarked($('show-marked').checked));
$('clear').addEventListener('click', reset);
$('export').addEventListener('click', exportCollage);
$('close-viewer').addEventListener('click', closeViewer);
$('viewer').addEventListener('cancel', event => { event.preventDefault(); closeViewer(); });
$('viewer').addEventListener('click', event => { if (event.target === $('viewer')) { const rect = $('viewer').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeViewer(); } });
$('play').addEventListener('click', () => { if (state.viewerPlaying) void pauseViewer(); else void playViewer(); });
$('frame').addEventListener('input', () => {
  // Scrubbing pauses playback and previews frames from the decoded sheet.
  if (state.viewerPlaying) stopViewerAnimation();
  const frame = Number($('frame').value);
  $('frame-number').textContent = `${frame + 1} / ${state.selected.frames}`;
  if (state.viewerPlayer) {
    ++state.viewerToken;
    state.viewerPlayer.show(frame);
    $('full-animation').hidden = false;
    $('full-image').hidden = true;
  }
});
$('frame').addEventListener('change', showFrame);
$('mark-viewer').addEventListener('click', () => setMarked(state.selected, !isMarked(state.selected)));
$('download-image').addEventListener('click', async () => {
  if (state.viewerPlaying) await pauseViewer();
  if (state.fullUrl && state.selected) download(state.fullUrl, `${state.selected.file.name.replace(/\.vtf$/i, '')}-frame-${Number($('frame').value) + 1}.png`);
});
$('marked').addEventListener('click', () => { $('marked-status').textContent = ''; renderMarked(); $('marked-dialog').showModal(); });
$('close-marked').addEventListener('click', () => $('marked-dialog').close());
$('marked-dialog').addEventListener('click', event => { if (event.target === $('marked-dialog')) { const rect = $('marked-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('marked-dialog').close(); } });
$('script-windows').addEventListener('click', () => downloadText(batchScript(markedPaths()), 'delete-marked-sprays.bat'));
$('script-unix').addEventListener('click', () => downloadText(shellScript(markedPaths()), 'delete-marked-sprays.sh'));
$('copy-marked').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(markedPaths().join('\n'));
    $('marked-status').textContent = 'File list copied.';
  } catch {
    downloadText(`${markedPaths().join('\n')}\n`, 'marked-sprays.txt');
    $('marked-status').textContent = 'Clipboard unavailable; downloaded the list instead.';
  }
});
$('unmark-all').addEventListener('click', () => {
  for (const entry of markedFiles()) state.marks.delete(markKey(entry));
  saveMarks(storage, state.marks);
  renderOrder();
  renderMarked();
});
let dragDepth = 0;
document.addEventListener('dragenter', event => { if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); ++dragDepth; $('drop-overlay').hidden = false; } });
document.addEventListener('dragover', event => { if ([...event.dataTransfer.types].includes('Files')) event.preventDefault(); });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop-overlay').hidden = true; } });
document.addEventListener('drop', async event => {
  event.preventDefault();
  dragDepth = 0;
  $('drop-overlay').hidden = true;
  try { const items = await collectDropItems(event.dataTransfer); loadFiles(items, items[0]?.path.includes('/') ? items[0].path.split('/')[0] : undefined); }
  catch (error) { notice(`Unable to read dropped folder: ${error.message}`); }
});
