#!/usr/bin/env node
/**
 * Guard: the desktop app's numeric-base version must agree across all five
 * version-bearing files.
 *
 * The desktop version lives in `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`,
 * `package.json` and `package-lock.json`. The release workflow re-applies the
 * version from the tag at build time (`npm version` / `perl`), which silently
 * **masks** a committed file that was never bumped — that is how
 * `package-lock.json` drifted to `0.0.2` while the app shipped `0.0.3`/`0.0.4`.
 * `npm ci` does not catch a root-`version` mismatch, so this does: it fails when
 * the five files disagree, keeping the committed source honest.
 *
 * Run via `npm run check:versions` (also part of `npm run check` / desktop CI).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DESK = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(DESK, p), "utf8");
const json = (p) => JSON.parse(read(p));

// The `uxnan-desktop` package entry in Cargo.lock (the FIRST one — our crate).
function cargoLockVersion(text) {
  const m = text.match(/name = "uxnan-desktop"\s*\nversion = "([^"]+)"/);
  return m ? m[1] : "(not found)";
}
// The [package] version in Cargo.toml (first `version = "…"`).
function cargoTomlVersion(text) {
  const m = text.match(/^\s*version = "([^"]+)"/m);
  return m ? m[1] : "(not found)";
}

const found = {
  "package.json": json("package.json").version,
  "package-lock.json (root)": json("package-lock.json").version,
  "package-lock.json (packages[''])": json("package-lock.json").packages[""].version,
  "src-tauri/tauri.conf.json": json("src-tauri/tauri.conf.json").version,
  "src-tauri/Cargo.toml": cargoTomlVersion(read("src-tauri/Cargo.toml")),
  "src-tauri/Cargo.lock": cargoLockVersion(read("src-tauri/Cargo.lock")),
};

const versions = new Set(Object.values(found));
if (versions.size !== 1) {
  console.error(
    "\nX Desktop version files disagree — a version bump left one behind " +
      "(silent drift; the release workflow would mask it). Bump ALL of them to " +
      "the same numeric base (see VERSIONS.md > Convention):\n",
  );
  for (const [file, v] of Object.entries(found)) {
    console.error(`  ${v}\t${file}`);
  }
  console.error("");
  process.exit(1);
}

console.log(`OK: desktop version files agree (${[...versions][0]})`);
