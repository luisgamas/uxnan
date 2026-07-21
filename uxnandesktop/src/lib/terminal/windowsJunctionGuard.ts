// Windows "Redirection Guard" detection + guidance (issue: commands like
// `npm install` / `cargo metadata` fail *inside* a Uxnan terminal but work in a
// standalone shell).
//
// Windows' redirection-trust mitigation refuses to traverse a reparse point
// (junction / symlink / mount) it deems "untrusted" — e.g. the junctions npm
// workspaces create in `node_modules`, or OneDrive Files On-Demand placeholders —
// and fails with `STATUS_UNTRUSTED_MOUNT_POINT` (Win32 448). A process running
// under Uxnan inherits a stricter context than a standalone terminal, so the same
// command that works in Windows Terminal fails here. Uxnan does NOT sandbox the
// shell (see `pty.rs`) and does NOT relax the OS mitigation — instead we DETECT
// the failure and GUIDE the user to a fix that preserves the security posture:
// move the project to a local path outside OneDrive (e.g. `C:\dev\…`).
//
// (A structural alternative — spawning PTYs from a separate process off the
// WebView2 host so children don't inherit the mitigation — is a large,
// cross-platform refactor tracked in `FOR-DEV.md`. This detection is the light,
// security-preserving path. The pure detection lives in
// `windowsJunctionDetector.ts`; this file adds the Windows gate + the toast.)

import { toast } from "$lib/toast";
import { i18n } from "$lib/i18n";
import { currentOS } from "$lib/platform";
import { feedJunctionDetector } from "$lib/terminal/windowsJunctionDetector";

export { forgetJunctionBlock } from "$lib/terminal/windowsJunctionDetector";

// App-wide throttle so running the failing command in several terminals at once
// doesn't stack identical toasts.
let lastShownAt = 0;
const COOLDOWN_MS = 20_000;

/** Feed a raw PTY output chunk. On Windows, the first time a terminal shows a
 *  redirection-guard / junction-traversal failure, surface a one-time, throttled
 *  toast that guides the user to the fix. No-op (and no scan cost) off Windows. */
export function scanForJunctionBlock(id: string, bytes: Uint8Array): void {
  if (currentOS() !== "windows") return;
  if (!feedJunctionDetector(id, bytes)) return;
  const now = Date.now();
  if (now - lastShownAt < COOLDOWN_MS) return;
  lastShownAt = now;
  toast.warning(i18n.t("terminal.junctionBlockTitle"), {
    description: i18n.t("terminal.junctionBlockDesc"),
    duration: 15_000,
  });
}
