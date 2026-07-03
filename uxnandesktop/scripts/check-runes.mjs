#!/usr/bin/env node
/**
 * Guard: Svelte 5 runes must not appear in plain `.ts` files.
 *
 * Runes ($state, $derived, $effect, $props, $bindable, $inspect, $host) are only
 * compiled by the Svelte compiler in `.svelte` and `.svelte.ts` / `.svelte.js`
 * files. In a plain `.ts` they are left as bare identifiers, so at runtime they
 * throw a ReferenceError ("$effect is not defined") — which crashes the
 * component that calls the module (blank screen).
 *
 * `svelte-check` types the runes as ambient globals and `vite build` leaves the
 * bare call in the bundle, so neither catches this. This script does: it scans
 * `src` for a rune call in a file that is NOT a `.svelte.ts` / `.svelte.js`, and
 * fails with the offending locations. This is exactly the class of bug that
 * shipped in 0.0.4 (`updateToast.ts`).
 *
 * Run via `npm run check:runes` (also part of desktop CI, verify-desktop.yml).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

// Rune call forms — `$rune(` or `$rune.method(` (e.g. `$derived.by(`).
// Built from a string so the source has no slash-delimited regex literals.
const RUNE = new RegExp(
  "\\$(?:state|derived|effect|props|bindable|inspect|host)\\s*[.(]",
);
const BLOCK_COMMENT = new RegExp("/\\*[\\s\\S]*?\\*/", "g");
const LINE_COMMENT = new RegExp("(^|[^:])//[^\\n]*", "g");
const NON_NEWLINE = new RegExp("[^\\n]", "g");

// Strip block + line comments so a rune mentioned in prose can't false-positive
// (a block comment is blanked in place to keep line numbers stable).
function stripComments(src) {
  return src
    .replace(BLOCK_COMMENT, (m) => m.replace(NON_NEWLINE, " "))
    .replace(LINE_COMMENT, (_, p1) => p1);
}

// A plain `.ts` (NOT `.svelte.ts`, NOT `.d.ts`) is where runes must never appear.
function isPlainTs(path) {
  return (
    path.endsWith(".ts") &&
    !path.endsWith(".svelte.ts") &&
    !path.endsWith(".d.ts")
  );
}

// Recursively collect files under a directory.
function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const offenders = [];
for (const file of walk(ROOT, [])) {
  if (!isPlainTs(file)) continue;
  const lines = stripComments(readFileSync(file, "utf8")).split(/\r?\n/);
  lines.forEach((line, i) => {
    if (RUNE.test(line)) {
      offenders.push({ file, line: i + 1, text: line.trim().slice(0, 100) });
    }
  });
}

if (offenders.length > 0) {
  console.error(
    "\nX Svelte runes found in plain .ts file(s). Runes only compile in " +
      ".svelte / .svelte.ts files; a plain .ts leaves them as an undefined " +
      "identifier and crashes at runtime (blank screen). Rename the file to " +
      "`*.svelte.ts` and update its import path.\n",
  );
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  ${o.text}`);
  }
  console.error("");
  process.exit(1);
}

console.log("OK: no Svelte runes in plain .ts files");
