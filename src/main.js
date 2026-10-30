import { createIcons, GalleryVerticalEnd, ShieldCheck, CodeXml, Download, FolderOpen, FilePlus2, Search, ArrowDownWideNarrow, ArrowUpNarrowWide, Grid2x2, Trash2, FolderPlus, FolderDown, X } from 'lucide';
import { formatBytes, sortEntries, exportLayout } from './catalog.js';
import { DecoderPool } from './pool.js';
import './style.css';

const icons = { GalleryVerticalEnd, ShieldCheck, CodeXml, Download, FolderOpen, FilePlus2, Search, ArrowDownWideNarrow, ArrowUpNarrowWide, Grid2x2, Trash2, FolderPlus, FolderDown, X };
const $ = id => document.getElementById(id);
const refreshIcons = () => createIcons({ icons });
const state = { entries: [], generation: 0, descending: true, pool: null, completed: 0, ready: 0, failed: 0, bytes: 0, viewerToken: 0, fullUrl: null, selected: null, refreshPending: false };
const dateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
refreshIcons();

function notice(message = '') {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}

function visibleEntries() {
  return sortEntries(state.entries, $('sort').value, state.descending, $('search').value);
}

function updateSummary() {
  const { ready, failed } = state;
  const count = state.entries.length;
  const pending = state.completed < count;
  $('summary').textContent = count ? `${ready.toLocaleString()} ${ready === 1 ? 'spray' : 'sprays'}${pending ? ` / ${count.toLocaleString()} files` : ''}${failed ? ` / ${failed.toLocaleString()} unreadable` : ''}${pending ? ' / Processing' : ''}` : 'No folder selected';
  $('footer-count').textContent = `${count.toLocaleString()} VTF files`;
  $('footer-size').textContent = formatBytes(state.bytes);
  $('progress').style.width = count && pending ? `${state.completed / count * 100}%` : '0';
  $('export').disabled = pending || !visibleEntries().some(entry => entry.url);
  $('clear').disabled = !count;
}

function scheduleRefresh() {
  if (state.refreshPending) return;
  state.refreshPending = true;
  setTimeout(() => {
    state.refreshPending = false;
    if ($('sort').value === 'dimensions') renderOrder();
    else updateSummary();
  }, 100);
}

function renderOrder() {
  const ordered = visibleEntries();
  const visible = new Set(ordered);
  for (const entry of state.entries) entry.tile.hidden = !visible.has(entry);
  // Move existing nodes instead of recreating decoded images when sorting.
  const fragment = document.createDocumentFragment();
  for (const entry of ordered) fragment.append(entry.tile);
  $('gallery').append(fragment);
  $('empty').hidden = state.entries.length > 0;
  $('gallery').hidden = state.entries.length === 0;
  $('no-results').hidden = state.entries.length === 0 || ordered.length > 0;
  updateSummary();
}

function tileFor(entry) {
  const tile = document.createElement('article');
  tile.className = 'spray-tile';
  tile.dataset.path = entry.path;
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
  tile.append(button, info);
  entry.button = button;
  entry.tile = tile;
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

function closeViewer() {
  ++state.viewerToken;
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
  for (const entry of state.entries) if (entry.url) URL.revokeObjectURL(entry.url);
  state.entries = [];
  state.completed = 0;
  state.ready = state.failed = state.bytes = 0;
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

function loadFiles(items, label) {
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
  state.bytes = candidates.reduce((sum, entry) => sum + entry.file.size, 0);
  $('collection-name').textContent = label || 'Spray collection';
  const fragment = document.createDocumentFragment();
  for (const entry of state.entries) fragment.append(tileFor(entry));
  $('gallery').append(fragment);
  state.pool = new DecoderPool();
  renderOrder();
  const generation = state.generation;
  for (const entry of visibleEntries()) void decodeEntry(entry, generation, state.pool);
  const skipped = items.length - candidates.length;
  if (skipped) notice(`${skipped.toLocaleString()} non-VTF ${skipped === 1 ? 'file' : 'files'} skipped.`);
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
    $('download-image').disabled = false;
  } catch (error) {
    if (token === state.viewerToken) $('viewer-meta').textContent = error.message;
  }
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
  $('viewer').showModal();
  void showFrame();
}

function download(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

async function exportCollage() {
  const entries = visibleEntries().filter(entry => entry.url);
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
  const descriptions = { date: ['Oldest first', 'Newest first'], size: ['Smallest first', 'Largest first'], name: ['A to Z', 'Z to A'], dimensions: ['Lowest resolution first', 'Highest resolution first'] };
  const label = descriptions[$('sort').value][Number(state.descending)];
  $('direction').title = label;
  $('direction').setAttribute('aria-label', label);
  $('direction').innerHTML = `<i data-lucide="${state.descending ? 'arrow-down-wide-narrow' : 'arrow-up-narrow-wide'}"></i>`;
  refreshIcons();
}
$('tile-size').addEventListener('input', () => document.documentElement.style.setProperty('--tile', `${$('tile-size').value}px`));
$('labels').addEventListener('change', () => $('gallery').classList.toggle('hide-labels', !$('labels').checked));
$('clear').addEventListener('click', reset);
$('export').addEventListener('click', exportCollage);
$('close-viewer').addEventListener('click', closeViewer);
$('viewer').addEventListener('cancel', event => { event.preventDefault(); closeViewer(); });
$('viewer').addEventListener('click', event => { if (event.target === $('viewer')) { const rect = $('viewer').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeViewer(); } });
$('frame').addEventListener('change', showFrame);
$('download-image').addEventListener('click', () => { if (state.fullUrl && state.selected) download(state.fullUrl, `${state.selected.file.name.replace(/\.vtf$/i, '')}-frame-${Number($('frame').value) + 1}.png`); });
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
