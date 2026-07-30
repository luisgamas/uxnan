/**
 * What may leave the machine.
 *
 * A benchmark result is meant to be attached to a PR and eventually published,
 * so it must not carry anything about the person who ran it. The collectors
 * already refuse to read command lines or environments; this module is the
 * second gate, applied to the whole document right before it is written, and the
 * thing the "no personal data" test asserts against.
 *
 * Removed: absolute paths (replaced by a stable, non-reversible tag), the user
 * name, the host name. Kept: executable basenames, counts, timings, sizes — the
 * measurement itself.
 */

import os from "node:os";
import crypto from "node:crypto";

/** Short, stable, non-reversible tag for a string (so two runs on the same box
 *  compare, without the string itself being recoverable). */
export function tag(value, salt = "uxnan-resource-benchmark") {
  return crypto
    .createHash("sha256")
    .update(`${salt}:${value}`)
    .digest("hex")
    .slice(0, 12);
}

/** The identifiers we scrub, longest first so a home directory is replaced
 *  before the user name inside it. */
function secrets() {
  const home = os.homedir();
  const user = os.userInfo().username;
  const host = os.hostname();
  const tmp = os.tmpdir();
  return [
    { value: tmp, replacement: "<tmp>" },
    { value: home, replacement: "<home>" },
    { value: user, replacement: "<user>" },
    { value: host, replacement: "<host>" },
  ]
    .filter((s) => typeof s.value === "string" && s.value.length >= 3)
    .sort((a, b) => b.value.length - a.value.length);
}

/**
 * Scrub one string: known identifiers first, then any surviving path.
 *
 * Substituting the home directory is not enough on its own — what follows it is
 * the folder names, and those are exactly the client and project names that must
 * not be published. So a path *under* a substituted root collapses too, keeping
 * only the root as context: `C:\Users\me\work\acme` becomes
 * `<home>/<path:1a2b3c4d5e6f>`. A bare absolute path (`D:\build\out`, `/srv/x`)
 * collapses whole.
 *
 * The tag is keyed by the path itself, so the same folder stays recognisable
 * across samples and runs without ever being readable.
 */
export function redactString(input, subs = secrets()) {
  if (typeof input !== "string") return input;
  let out = input;
  for (const { value, replacement } of subs) {
    if (!value) continue;
    out = splitReplace(out, value, replacement);
    // Windows paths arrive with either separator depending on who wrote them.
    if (value.includes("\\")) out = splitReplace(out, value.replace(/\\/g, "/"), replacement);
  }
  // Segments hanging off a substituted root. `[^\s"'<>|]` excludes `<`, so an
  // already-replaced `<path:…>` can never be matched a second time.
  out = out.replace(
    /(<home>|<tmp>)((?:[\\/][^\s"'<>|]+)+)/g,
    (_, root, rest) => `${root}/<path:${tag(rest)}>`,
  );
  out = out.replace(/(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s"'<>|]{2,}/g, (m) => `<path:${tag(m)}>`);
  return out;
}

/** Case-insensitive literal replace (paths on Windows differ only in case). */
function splitReplace(haystack, needle, replacement) {
  if (!needle) return haystack;
  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let out = "";
  let i = 0;
  for (;;) {
    const at = lowerHay.indexOf(lowerNeedle, i);
    if (at === -1) {
      out += haystack.slice(i);
      return out;
    }
    out += haystack.slice(i, at) + replacement;
    i = at + needle.length;
  }
}

/**
 * Deep-scrub a result document. Objects and arrays are rebuilt; strings go
 * through [`redactString`]; numbers, booleans and `null` pass through.
 *
 * Keys are scrubbed too, because a map keyed by workspace path would otherwise
 * leak the path it was keyed by.
 */
export function redact(value, subs = secrets()) {
  if (typeof value === "string") return redactString(value, subs);
  if (Array.isArray(value)) return value.map((v) => redact(v, subs));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[redactString(k, subs)] = redact(v, subs);
    return out;
  }
  return value;
}

/**
 * Assert a document is clean — used by the harness before writing and by the
 * tests. Returns the offending strings (empty array = clean) rather than
 * throwing, so a caller can report all of them at once.
 */
export function findLeaks(value, subs = secrets()) {
  const found = [];
  const needles = subs.map((s) => s.value.toLowerCase()).filter(Boolean);
  const walk = (v) => {
    if (typeof v === "string") {
      const lower = v.toLowerCase();
      for (const n of needles) if (lower.includes(n)) found.push(v);
      if (/(?:[A-Za-z]:[\\/])/.test(v)) found.push(v);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, sub] of Object.entries(v)) {
        walk(k);
        walk(sub);
      }
    }
  };
  walk(value);
  return [...new Set(found)];
}
