import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Libraries a view can use with no network: the page names one with
 * `<script src="uxnan:<name>"></script>` and the bridge puts the library's
 * code in its place when it prepares the page. The page keeps its no-network
 * policy, works offline and over the relay, and loads instantly — what a CDN
 * would give, without the page reaching the internet.
 *
 * A library is added only when it is MIT/BSD/Apache licensed, maintained, and
 * small enough to ride in every view that uses it.
 */
export interface ViewLibrary {
  /** The name a page uses (`uxnan:<name>`). */
  name: string;
  /** What it defines on `window`, for the tool's description. */
  global: string;
  /** What it is for, in a few words. */
  purpose: string;
  /** The package the code comes from, and its file inside it. */
  pkg: string;
  file: string;
}

export const VIEW_LIBRARIES: readonly ViewLibrary[] = [
  {
    name: 'chart.js',
    global: 'Chart',
    purpose: 'charts (bar, line, pie, doughnut, radar, scatter)',
    pkg: 'chart.js',
    file: 'dist/chart.umd.min.js',
  },
];

const requireFrom = createRequire(import.meta.url);
const code = new Map<string, string>();

/** A library's code, read once. A `</script` inside it is escaped so it
 *  cannot close the element it is put in. */
function libraryCode(library: ViewLibrary): string {
  let source = code.get(library.name);
  if (source === undefined) {
    // The package's `exports` hide its files; its own entry point says where
    // the package is, and the file is read from there.
    source = readFileSync(join(packageRoot(library.pkg), library.file), 'utf8').replace(
      /<\/script/gi,
      '<\\/script',
    );
    code.set(library.name, source);
  }
  return source;
}

/** The folder of an installed package: up from its entry point to the
 *  `package.json` that names it. */
function packageRoot(pkg: string): string {
  let dir = dirname(requireFrom.resolve(pkg));
  for (;;) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        name?: unknown;
      };
      if (manifest.name === pkg) return dir;
    } catch {
      /* no manifest here: keep going up */
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`The view library package ${pkg} is not installed.`);
    dir = parent;
  }
}

const LIBRARY_TAG = /<script\b[^>]*\bsrc\s*=\s*["']uxnan:([^"']+)["'][^>]*>\s*<\/script\s*>/gi;

/**
 * The page with every `<script src="uxnan:<name>"></script>` replaced by that
 * library's code. Throws, naming the libraries there are, when a page asks
 * for one there is not.
 */
export function inlineViewLibraries(html: string): { html: string; used: string[] } {
  const used: string[] = [];
  const out = html.replace(LIBRARY_TAG, (_tag, raw: string) => {
    const name = raw.trim().toLowerCase();
    const library = VIEW_LIBRARIES.find((l) => l.name === name);
    if (!library) {
      throw new Error(
        `There is no view library "${raw}". Available: ${VIEW_LIBRARIES.map((l) => `uxnan:${l.name}`).join(', ')}.`,
      );
    }
    if (!used.includes(name)) used.push(name);
    return `<script>${libraryCode(library)}</script>`;
  });
  return { html: out, used };
}

/** The libraries, as the tool's description lists them. */
export function describeViewLibraries(): string {
  return VIEW_LIBRARIES.map(
    (l) => `<script src="uxnan:${l.name}"></script> for ${l.purpose} (global ${l.global})`,
  ).join('; ');
}
