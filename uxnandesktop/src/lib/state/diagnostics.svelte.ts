// What the app knows about its own last session, for the one thing the user
// needs to be told: the previous session ended without reaching its clean exit
// path (a crash, a force-close after a black screen, or a kill).
//
// That matters to them, not just to us — terminal scrollback is persisted on the
// clean path only, so an unclean exit is exactly why a restored workspace comes
// back with empty terminals. Saying so turns a silent, confusing loss into an
// explained one, and points at the log that now records why.
//
// Read once at boot. `diagnostics_report` is a pure read of state the backend
// already computed at startup, so there is nothing to poll and no cost while
// nothing is wrong.

import { diagnosticsReport } from "$lib/api";

class DiagnosticsState {
  /** True when the previous session never reached its clean exit path. */
  previousSessionUnclean = $state(false);
  /** Absolute path of the live log file, or null if the sink failed to start. */
  logPath = $state<string | null>(null);
  /** Set once the user acknowledges the notice, so it does not come back. */
  dismissed = $state(false);
  /** True once the backend has answered (so the UI never flashes a wrong state). */
  loaded = $state(false);

  /** Whether the recovery notice should be on screen. */
  get noticeVisible(): boolean {
    return this.loaded && this.previousSessionUnclean && !this.dismissed;
  }

  /** Read the report once, at boot. Failure is silent: a diagnostics read that
   *  cannot answer must never block or noise up startup. */
  async start(): Promise<void> {
    try {
      const report = await diagnosticsReport();
      this.previousSessionUnclean = report.previousSessionUnclean;
      this.logPath = report.logPath;
    } catch {
      // Older backend, or the command is unavailable — stay quiet.
    } finally {
      this.loaded = true;
    }
  }

  dismiss(): void {
    this.dismissed = true;
  }
}

export const diagnostics = new DiagnosticsState();
