// Lightweight OS detection from the webview user agent. Used to surface an
// "untested platform" notice: the app is developed and validated on Windows;
// macOS/Linux support is implemented but not yet verified on real hardware.

export type OS = "windows" | "macos" | "linux" | "other";

export function currentOS(ua?: string): OS {
  const agent = ua ?? (typeof navigator === "undefined" ? "" : navigator.userAgent);
  if (/Windows/i.test(agent)) return "windows";
  if (/Mac/i.test(agent)) return "macos";
  if (/Linux|X11/i.test(agent)) return "linux";
  return "other";
}

/** Human label for an OS (for notices). */
export function osLabel(os: OS = currentOS()): string {
  return os === "macos" ? "macOS" : os === "linux" ? "Linux" : os === "windows" ? "Windows" : "this platform";
}

/** The app has only been validated on Windows so far. */
export const isUntestedPlatform: boolean =
  currentOS() === "macos" || currentOS() === "linux";
