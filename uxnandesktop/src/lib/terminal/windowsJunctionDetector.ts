// Pure detector for Windows "Redirection Guard" / junction-traversal failures in
// terminal output. Kept side-effect-free (no toast / OS / i18n imports) so it's
// unit-testable in isolation; `windowsJunctionGuard.ts` wraps it with the
// Windows gate + the user-facing toast. See that file for the full rationale.

// Locale-independent where possible: `os error 448` (Rust std) and `errno -4094`
// (libuv's UNKNOWN, what npm/node print for the same 448) are NOT localized; the
// human message ("untrusted mount point" / "punto de montaje no confiable") IS,
// so we key off the codes and add the English phrase only as a bonus.
const SIGNATURES = ["os error 448", "errno -4094", "untrusted mount point"];

/** True when `text` contains a redirection-guard / junction-traversal failure
 *  signature (case-insensitive). Pure. */
export function matchesJunctionBlock(text: string): boolean {
  const t = text.toLowerCase();
  return SIGNATURES.some((s) => t.includes(s));
}

const decoder = new TextDecoder();
// A signature can straddle two output chunks, so keep a short rolling tail per
// terminal; `fired` makes detection at-most-once per terminal.
const tails = new Map<string, string>();
const fired = new Set<string>();
const TAIL = 256;

/** Feed a raw PTY output chunk for terminal `id`. Returns true the FIRST time
 *  that terminal shows a signature; false otherwise (and once fired, always
 *  false until `forgetJunctionBlock`). Side-effect-free. */
export function feedJunctionDetector(id: string, bytes: Uint8Array): boolean {
  if (fired.has(id)) return false;
  const text = (tails.get(id) ?? "") + decoder.decode(bytes);
  if (matchesJunctionBlock(text)) {
    fired.add(id);
    tails.delete(id);
    return true;
  }
  tails.set(id, text.slice(-TAIL));
  return false;
}

/** Drop a terminal's detection state when its tab closes. */
export function forgetJunctionBlock(id: string): void {
  tails.delete(id);
  fired.delete(id);
}
