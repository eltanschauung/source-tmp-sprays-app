const STORAGE_KEY = 'source-sprays-marked';

// Marks follow the normalized file hash, so a marked spray stays hidden when it
// is downloaded again under another name. Unreadable files fall back to path.
export function markKey(entry) {
  return entry.fingerprint ? `md5:${entry.fingerprint}` : `path:${entry.path}`;
}

export function loadMarks(storage) {
  try {
    const value = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
    return new Set(Array.isArray(value) ? value.filter(key => typeof key === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveMarks(storage, marks) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify([...marks]));
  } catch {
    // Private windows and blocked storage keep marks for this page only.
  }
}

const DUPLICATES_KEY = 'source-sprays-delete-duplicates';

// Whether hidden older copies of duplicate sprays go on the deletion list.
export function loadIncludeDuplicates(storage) {
  try {
    return storage?.getItem(DUPLICATES_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveIncludeDuplicates(storage, include) {
  try {
    storage?.setItem(DUPLICATES_KEY, include ? '1' : '0');
  } catch {
    // Falls back to this page only, like marks.
  }
}

// Folder imports include the chosen folder's name; scripts run inside it.
export function relativePath(path, root) {
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

// Names Windows cannot create; refusing them also rules out quote/newline injection.
const WINDOWS_UNSAFE = /["<>|?*:\x00-\x1f]/;

export function batchScript(paths) {
  const quoted = paths.filter(path => !WINDOWS_UNSAFE.test(path)).map(path => `"${path.replace(/\//g, '\\').replace(/%/g, '%%')}"`);
  return [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    'chcp 65001 >nul',
    'cd /d "%~dp0"',
    ...quoted.map(path => `if exist ${path} goto found`),
    'echo None of the marked sprays are in this folder:',
    'echo "%CD%"',
    'echo Put this script in the folder you opened in Source Sprays Collage.',
    'pause',
    'exit /b 1',
    ':found',
    `echo This deletes ${quoted.length} marked spray ${quoted.length === 1 ? 'file' : 'files'} from:`,
    'echo "%CD%"',
    'echo Close this window to cancel, or',
    'pause',
    ...quoted.map(path => `if exist ${path} del /f /q ${path}`),
    'echo Done.',
    'pause',
  ].join('\r\n') + '\r\n';
}

const shellQuote = value => `'${value.replace(/'/g, `'\\''`)}'`;

export function shellScript(paths) {
  return [
    '#!/bin/sh',
    'cd "$(dirname "$0")" || exit 1',
    `set -- ${paths.map(shellQuote).join(' ')}`,
    'found=',
    'for file do [ -e "$file" ] && found=1; done',
    '[ -n "$found" ] || { echo "None of the marked sprays are in $PWD. Put this script in the folder you opened in Source Sprays Collage."; exit 1; }',
    'printf \'Delete %s marked spray files from %s? [y/N] \' "$#" "$PWD"',
    'read -r answer',
    'case "$answer" in [yY]*) ;; *) echo Cancelled.; exit 1 ;; esac',
    'rm -f -- "$@"',
    'echo Done.',
  ].join('\n') + '\n';
}
