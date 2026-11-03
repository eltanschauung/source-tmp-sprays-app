const STORAGE_KEY = 'source-sprays-favorites';

// Favorites map a mark key (normalized hash) to the spray name chosen for it.
export function loadFavorites(storage) {
  try {
    const value = JSON.parse(storage?.getItem(STORAGE_KEY) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return new Map();
    return new Map(Object.entries(value).filter(([, name]) => typeof name === 'string'));
  } catch {
    return new Map();
  }
}

export function saveFavorites(storage, favorites) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(favorites)));
  } catch {
    // Private windows and blocked storage keep favorites for this page only.
  }
}

// Letters, digits, spaces, hyphens and underscores: safe as a file name, a
// material path and a batch-script argument.
const NAME = /^[A-Za-z0-9_-](?:[A-Za-z0-9 _-]{0,62}[A-Za-z0-9_-])?$/;

export function defaultSprayName(fileName) {
  const base = fileName.replace(/\.vtf$/i, '').replace(/[^A-Za-z0-9 _-]+/g, '_').trim().slice(0, 64);
  return NAME.test(base) ? base : 'spray';
}

// Returns an error message for each name that cannot be installed, keyed by index.
export function validateSprayNames(names) {
  const errors = new Map();
  const seen = new Map();
  names.forEach((name, index) => {
    if (!name) errors.set(index, 'Enter a name.');
    else if (!NAME.test(name)) errors.set(index, 'Use letters, numbers, spaces, - and _ (up to 64; no space at either end).');
    else if (seen.has(name.toLowerCase())) errors.set(index, `Same name as "${names[seen.get(name.toLowerCase())]}".`);
    else seen.set(name.toLowerCase(), index);
  });
  return errors;
}

// Batch-script arguments go through CALL, which re-expands % and ^, so those
// paths (and names Windows cannot create) are left out.
const BATCH_UNSAFE = /["<>|?*:%^\x00-\x1f]/;

const vmt = name => [
  '"UnlitGeneric"',
  '{',
  `\t"$basetexture"\t"vgui/logos/${name}"`,
  '\t"$translucent" "1"',
  '\t"$ignorez" "1"',
  '\t"$vertexcolor" "1"',
  '\t"$vertexalpha" "1"',
  '}',
];

// The spray menu's preview material, as TF2 writes it into logos/ui.
const uiVmt = name => [
  '"UnlitGeneric"',
  '{',
  '\t"$translucent" 1',
  `\t"$basetexture" "VGUI/logos/${name}"`,
  '\t"$vertexcolor" 1',
  '\t"$vertexalpha" 1',
  '\t"$no_fullbright" 1',
  '\t"$ignorez" 1',
  '}',
];

// items: [{ path (relative to the opened folder), name }]
export function installBatchScript(items) {
  const safe = items.filter(({ path, name }) => !BATCH_UNSAFE.test(path) && NAME.test(name));
  const write = (file, lines) => lines.map((line, i) => `${i ? '>>' : '>'}"${file}" echo ${line}`);
  return [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    'cd /d "%~dp0"',
    'set "LOGOS=%~dp0..\\vgui\\logos"',
    'if exist "%LOGOS%\\" goto found',
    'echo Could not find vgui\\logos next to this folder.',
    'set /p "LOGOS=Drag your tf\\materials\\vgui\\logos folder into this window and press Enter: "',
    'set "LOGOS=%LOGOS:"=%"',
    'if exist "%LOGOS%\\" goto found',
    'echo That folder does not exist.',
    'pause',
    'exit /b 1',
    ':found',
    // UTF-8 for non-ASCII file names; only after SET /P, which reads nothing under code page 65001.
    'chcp 65001 >nul',
    'if not exist "%LOGOS%\\ui\\" mkdir "%LOGOS%\\ui"',
    `echo This installs ${safe.length} favorite ${safe.length === 1 ? 'spray' : 'sprays'} into:`,
    'echo "%LOGOS%"',
    'echo Existing sprays with the same name are never replaced.',
    'echo Close this window to cancel, or',
    'pause',
    ...safe.map(({ path, name }) => `call :install "${path.replace(/\//g, '\\')}" "${name}"`),
    'echo.',
    'echo Done. Pick them in TF2 under Options, Multiplayer, Spray.',
    'pause',
    'exit /b 0',
    '',
    ':install',
    'if not exist "%~1" goto missing',
    'if exist "%LOGOS%\\%~2.vtf" goto exists',
    'copy /y "%~1" "%LOGOS%\\%~2.vtf" >nul',
    ...write('%LOGOS%\\%~2.vmt', vmt('%~2')),
    ...write('%LOGOS%\\ui\\%~2.vmt', uiVmt('%~2')),
    'echo Installed %~2',
    'exit /b',
    ':missing',
    'echo Skipped "%~1": not found next to this script',
    'exit /b',
    ':exists',
    'echo Skipped %~2: a spray with that name is already in logos',
    'exit /b',
  ].join('\r\n') + '\r\n';
}

const shellQuote = value => `'${value.replace(/'/g, `'\\''`)}'`;
// A printf format for a VMT whose name is filled in from "$2".
const printfFormat = template => template('\u0000').join('\n')
  .replace(/\\/g, '\\\\').replace(/%/g, '%%').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\u0000/g, '%s');

export function installShellScript(items) {
  const safe = items.filter(({ name }) => NAME.test(name));
  return [
    '#!/bin/sh',
    'cd "$(dirname "$0")" || exit 1',
    'logos=../vgui/logos',
    'if [ ! -d "$logos" ]; then',
    '  printf \'Path to your tf/materials/vgui/logos folder: \'',
    '  read -r logos',
    'fi',
    '[ -d "$logos" ] || { echo "That folder does not exist."; exit 1; }',
    'mkdir -p "$logos/ui"',
    `printf 'Install ${safe.length} favorite sprays into %s? Existing names are never replaced. [y/N] ' "$logos"`,
    'read -r answer',
    'case "$answer" in [yY]*) ;; *) echo Cancelled.; exit 1 ;; esac',
    'install() {',
    '  [ -e "$1" ] || { echo "Skipped $1: not found next to this script"; return; }',
    '  [ -e "$logos/$2.vtf" ] && { echo "Skipped $2: a spray with that name is already in logos"; return; }',
    '  cp -- "$1" "$logos/$2.vtf"',
    `  printf '${printfFormat(vmt)}\\n' "$2" > "$logos/$2.vmt"`,
    `  printf '${printfFormat(uiVmt)}\\n' "$2" > "$logos/ui/$2.vmt"`,
    '  echo "Installed $2"',
    '}',
    ...safe.map(({ path, name }) => `install ${shellQuote(path)} ${shellQuote(name)}`),
    'echo Done.',
  ].join('\n') + '\n';
}
