// Pure helpers for the auto-updater, split out of the runes store so they can be
// unit-tested without a Svelte runtime (see updaterLogic.test.ts). The store
// (state/updater.svelte.ts) owns the reactive state and side effects; this owns
// the small decisions.

import type { InstallPolicy } from "$lib/types";

/** Download progress as a 0–1 fraction, or null when the total is unknown
 *  (the server didn't send a content length). Clamped to [0, 1]. */
export function downloadFraction(
  downloaded: number,
  contentLength: number | null | undefined,
): number | null {
  if (!contentLength || contentLength <= 0) return null;
  return Math.max(0, Math.min(1, downloaded / contentLength));
}

/** What to do once an update has been downloaded, given the install policy and
 *  whether any agent is currently working:
 *   - `installNow`  — apply it right away (safe: nothing running, or policy says
 *                     install-when-idle and we're already idle).
 *   - `armIdle`     — wait, then install automatically once agents go idle.
 *   - `wait`        — do nothing; the user will choose from the banner.
 *  Installing restarts the app (stopping agents), so we never return `installNow`
 *  while an agent works unless the user explicitly triggers it elsewhere. */
export function nextInstallAction(
  policy: InstallPolicy,
  agentsBusy: boolean,
): "installNow" | "armIdle" | "wait" {
  if (policy === "whenIdle") return agentsBusy ? "armIdle" : "installNow";
  // "ask" and "manual" both wait for an explicit action.
  return "wait";
}

/** What a finished check means, given what is already staged for install.
 *  `found` is the version the manifest offered (`null` = nothing newer than the
 *  running build); `staged` is the version whose installer is already downloaded
 *  (`null` = nothing staged).
 *
 *   - `upToDate`   — nothing new and nothing staged.
 *   - `available`  — a newer version to download.
 *   - `keepStaged` — the staged installer is still what the channel offers, so it
 *                    stays ready to install. Crucial: a check re-runs against the
 *                    *running* version, so it keeps re-reporting the version we
 *                    already downloaded — treating that as "available" would
 *                    download the same bytes again on every check.
 *   - `superseded` — the channel now offers a **different** version, so the staged
 *                    bytes are stale (`updater_install` rejects them) and must be
 *                    re-downloaded. This is what lets a second release land while
 *                    the first one sits downloaded, without restarting the app. */
export function checkOutcome(
  found: string | null,
  staged: string | null,
): "upToDate" | "available" | "keepStaged" | "superseded" {
  if (!staged) return found ? "available" : "upToDate";
  // A check that finds nothing while bytes are staged (e.g. the release was
  // pulled) leaves the download alone — install re-checks and reports honestly.
  return found && found !== staged ? "superseded" : "keepStaged";
}
