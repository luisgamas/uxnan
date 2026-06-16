// Lightweight OS detection from the webview user agent. Used to surface an
// "untested platform" notice: the app is developed and validated on Windows;
// macOS/Linux support is implemented but not yet verified on real hardware.

export type OS = "windows" | "macos" | "linux" | "other";

export function currentOS(): OS {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac/i.test(ua)) return "macos";
  if (/Linux|X11/i.test(ua)) return "linux";
  return "other";
}

/** Human label for an OS (for notices). */
export function osLabel(os: OS = currentOS()): string {
  return os === "macos" ? "macOS" : os === "linux" ? "Linux" : os === "windows" ? "Windows" : "this platform";
}

/** The app has only been validated on Windows so far. */
export const isUntestedPlatform: boolean =
  currentOS() === "macos" || currentOS() === "linux";
