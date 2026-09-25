// The welcome tour: what Uxnan is and what it can do, shown once on the first
// start (and again when a newer tour ships), reopened any time from the profile
// menu. Finishing or skipping it records the version seen (`welcomeSeen` in the
// app settings), so it never shows up unasked twice.

import { app } from "$lib/state/app.svelte";

/** Bump when the tour gains something every user should see once. */
export const WELCOME_VERSION = 1;

class WelcomeUi {
  open = $state(false);

  /** On start: show the tour if this version was never seen. */
  showIfNew(): void {
    if ((app.settings.welcomeSeen ?? 0) < WELCOME_VERSION) this.open = true;
  }

  /** From the menu: show it again. */
  show(): void {
    this.open = true;
  }

  /** Finished or skipped: record it and close. */
  done(): void {
    this.open = false;
    if ((app.settings.welcomeSeen ?? 0) >= WELCOME_VERSION) return;
    app.settings.welcomeSeen = WELCOME_VERSION;
    void app.persistSettings();
  }
}

export const welcome = new WelcomeUi();
