// In-app auto-updater state machine (Settings → Updates).
//
// Orchestrates the three steps the Rust `updater.rs` exposes — check, background
// download, install — around the user's preferences and, crucially, around agent
// activity: installing restarts the app and so stops every running agent, so we
// never install while an agent is working unless the user explicitly chooses to.
//
//   check ──▶ available ──▶ (auto?)download ──▶ downloaded ──▶ install ─▶ restart
//
// Downloading is harmless and may run in the background automatically. Installing
// is gated: `ask` waits for a banner choice, `whenIdle` auto-installs once no
// agent is working, `manual` only on an explicit click. The "Install now anyway"
// path is always available for an impatient user.

import { listen } from "@tauri-apps/api/event";
import {
  updaterCheck,
  updaterDownload,
  updaterInstall,
  updaterStaged,
} from "$lib/api";
import { app } from "./app.svelte";
import { anyAgentWorking } from "./agentDisplay";
import { toast, toastError } from "$lib/toast";
import { i18n } from "$lib/i18n";
import { downloadFraction, nextInstallAction } from "$lib/updaterLogic";
import type { UpdateDownloadProgress, UpdateInfo } from "$lib/types";

/** How often to re-check for updates in the background (6 h). */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Delay the first auto-check briefly so it never competes with app hydration. */
const INITIAL_CHECK_DELAY_MS = 8_000;
/** While waiting to install on idle, re-evaluate agent activity this often. */
const IDLE_POLL_MS = 2_000;

/** Where the updater is in its lifecycle. */
export type UpdaterStatus =
  | "idle" // nothing known yet / dismissed
  | "checking"
  | "upToDate"
  | "available" // a newer version exists, not downloaded
  | "downloading"
  | "downloaded" // staged, ready to install
  | "installing"
  | "error";

class UpdaterStore {
  /** Current lifecycle state. */
  status = $state<UpdaterStatus>("idle");
  /** The available/downloaded update's metadata, when one is known. */
  update = $state<UpdateInfo | null>(null);
  /** Live download progress (null unless downloading). */
  progress = $state<UpdateDownloadProgress | null>(null);
  /** Last error message (status === "error"). */
  error = $state<string | null>(null);
  /** When the last check completed (epoch ms), for the Settings "last checked". */
  lastChecked = $state<number | null>(null);
  /** The user dismissed the banner for the current version (re-shown on a newer
   *  one). Hides the banner without cancelling a background download/install. */
  dismissed = $state(false);

  private started = false;
  private checkTimer: ReturnType<typeof setInterval> | undefined;
  private idleTimer: ReturnType<typeof setInterval> | undefined;
  /** Armed when an install should fire as soon as agents go idle. */
  private armedForIdle = false;

  /** Whether any agent is currently working (drives the install guard + banner
   *  copy). Reactive: reads the monitoring stores. */
  get agentsBusy(): boolean {
    return anyAgentWorking();
  }

  /** Download progress as a 0–1 fraction, or null when the total is unknown. */
  get progressFraction(): number | null {
    const p = this.progress;
    return p ? downloadFraction(p.downloaded, p.contentLength) : null;
  }

  /** Subscribe to backend download events + kick off the first check (once). */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      await listen<UpdateDownloadProgress>("updater:download-progress", (e) => {
        this.progress = e.payload;
      });
      await listen<UpdateInfo>("updater:downloaded", (e) => {
        this.onDownloaded(e.payload);
      });
    } catch {
      // No Tauri event bus (web preview) — checks below will just no-op.
    }
    // Restore a download staged before a reload, so the banner reappears.
    try {
      const stagedVersion = await updaterStaged();
      if (stagedVersion) {
        this.update = {
          version: stagedVersion,
          currentVersion: "",
          notes: null,
          date: null,
        };
        this.status = "downloaded";
        this.maybeAutoInstall();
      }
    } catch {
      // ignore — backend unreachable
    }
    if (app.settings.updater?.autoCheck !== false) {
      setTimeout(() => void this.checkNow(true), INITIAL_CHECK_DELAY_MS);
      this.checkTimer = setInterval(
        () => void this.checkNow(true),
        CHECK_INTERVAL_MS,
      );
    }
  }

  /** Check the configured channel for a newer version. `auto` checks stay quiet
   *  (no toast on up-to-date / transient error); a manual check reports both. */
  async checkNow(auto = false): Promise<void> {
    // Don't interrupt an in-flight download/install with a re-check.
    if (this.status === "downloading" || this.status === "installing") return;
    this.status = "checking";
    this.error = null;
    try {
      const info = await updaterCheck();
      this.lastChecked = Date.now();
      if (info) {
        // A genuinely new version resets a prior dismissal.
        if (this.update?.version !== info.version) this.dismissed = false;
        this.update = info;
        this.status = "available";
        if (app.settings.updater?.autoDownload !== false) {
          void this.download();
        }
      } else {
        this.update = null;
        this.status = "upToDate";
        if (!auto) toast.success(i18n.t("updates.upToDate"));
      }
    } catch (e) {
      this.status = "error";
      this.error = e instanceof Error ? e.message : String(e);
      if (!auto) toastError(e);
    }
  }

  /** Download the available update in the background (non-disruptive). */
  async download(): Promise<void> {
    if (this.status === "downloading" || this.status === "downloaded") return;
    this.status = "downloading";
    this.progress = null;
    this.error = null;
    try {
      const info = await updaterDownload();
      // The `updater:downloaded` event also calls onDownloaded; this covers the
      // web-preview / no-event-bus case and keeps the promise meaningful.
      this.onDownloaded(info);
    } catch (e) {
      this.status = "error";
      this.error = e instanceof Error ? e.message : String(e);
      toastError(e);
    }
  }

  /** Transition into the "downloaded" (staged) state and apply the install
   *  policy. Idempotent — safe to call from both the promise and the event. */
  private onDownloaded(info: UpdateInfo): void {
    this.update = info;
    this.progress = null;
    if (this.status !== "installing") this.status = "downloaded";
    this.maybeAutoInstall();
  }

  /** Apply the configured install policy once an update is staged. */
  private maybeAutoInstall(): void {
    const policy = app.settings.updater?.installPolicy ?? "ask";
    const action = nextInstallAction(policy, this.agentsBusy);
    if (action === "installNow") void this.installNow();
    else if (action === "armIdle") this.installWhenIdle();
    // "wait" → an explicit banner action is required.
  }

  /** Install as soon as no agent is working. If already idle, installs now;
   *  otherwise polls until the safe window opens. */
  installWhenIdle(): void {
    if (this.status === "installing") return;
    if (!this.agentsBusy) {
      void this.installNow();
      return;
    }
    if (this.armedForIdle) return;
    this.armedForIdle = true;
    toast.info(i18n.t("updates.willInstallWhenIdle"));
    this.idleTimer = setInterval(() => {
      if (!this.agentsBusy) {
        this.disarmIdle();
        void this.installNow();
      }
    }, IDLE_POLL_MS);
  }

  /** Cancel a pending install-when-idle (e.g. the user picked "Later"). */
  disarmIdle(): void {
    this.armedForIdle = false;
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  /** Install the staged update now and restart — **stops running agents**. The
   *  backend closes terminals cleanly first; this call does not return on
   *  success (the app restarts). */
  async installNow(): Promise<void> {
    if (this.status === "installing") return;
    this.disarmIdle();
    this.status = "installing";
    this.error = null;
    try {
      await updaterInstall(); // resolves only if the restart didn't happen
    } catch (e) {
      this.status = "downloaded"; // back to a re-tryable state
      this.error = e instanceof Error ? e.message : String(e);
      toastError(e);
    }
  }

  /** Hide the banner for the current version without cancelling work. */
  dismiss(): void {
    this.dismissed = true;
    this.disarmIdle();
  }

  /** Whether the banner should be visible: there's something actionable and the
   *  user hasn't dismissed it. */
  get bannerVisible(): boolean {
    if (this.dismissed) return false;
    return (
      this.status === "available" ||
      this.status === "downloading" ||
      this.status === "downloaded" ||
      this.status === "installing"
    );
  }
}

/** Singleton auto-updater store shared across the app. */
export const updater = new UpdaterStore();
