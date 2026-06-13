// Thin wrapper over the OS notification plugin. Permission is requested lazily
// on the first notification (so the app doesn't prompt at startup), and every
// call is best-effort — a missing plugin / denied permission / web preview just
// no-ops instead of throwing.

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let granted: boolean | null = null;

async function ensurePermission(): Promise<boolean> {
  if (granted !== null) return granted;
  try {
    granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
  } catch {
    granted = false;
  }
  return granted;
}

/** Pre-request notification permission at a sensible moment (e.g. when the user
 *  launches an agent, while the app is focused) so the first real notification
 *  isn't lost waiting on a prompt. Best-effort. */
export function primeNotifications(): void {
  void ensurePermission();
}

/** Show a native OS notification (best-effort; never throws). */
export async function notify(title: string, body: string): Promise<void> {
  try {
    if (await ensurePermission()) sendNotification({ title, body });
  } catch {
    // No notification plugin (e.g. the plain web preview) — ignore.
  }
}
