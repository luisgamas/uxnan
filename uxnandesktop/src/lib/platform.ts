// Lightweight OS detection from the webview user agent. Used to surface the
// "experimental platform" badge: the app is developed and validated on Windows
// first, so macOS and Linux ship as experimental — implemented in full and built
// in CI, but not yet exercised end-to-end on that hardware by the maintainer.
// The word is deliberately the one the READMEs, the install guide and the site
// already use for these builds; the status bar must not say something harsher
// than the page a user downloaded from.

export type OS = "windows" | "macos" | "linux" | "other";

export function currentOS(ua?: string): OS {
  const agent = ua ?? (typeof navigator === "undefined" ? "" : navigator.userAgent);
  if (/Windows/i.test(agent)) return "windows";
  if (/Mac/i.test(agent)) return "macos";
  if (/Linux|X11/i.test(agent)) return "linux";
  return "other";
}

/** Human label for an OS (for the experimental badge and other notices). */
export function osLabel(os: OS = currentOS()): string {
  return os === "macos" ? "macOS" : os === "linux" ? "Linux" : os === "windows" ? "Windows" : "this platform";
}

/** Whether this platform's build is one of the experimental ones (macOS,
 *  Linux). Windows is the validated one. */
export const isExperimentalPlatform: boolean =
  currentOS() === "macos" || currentOS() === "linux";
