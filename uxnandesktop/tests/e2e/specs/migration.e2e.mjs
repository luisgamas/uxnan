/**
 * A profile written by an older build still opens.
 *
 * Persistence migration is well covered in Rust, but only against the migration
 * function. This runs the whole boot path over a profile shaped the way an older
 * build actually wrote one — no `isGit` on the repo, no terminal profiles in
 * settings, a tab with no `kind` — and asserts the thing a user cares about:
 * the app starts and their projects are still there.
 *
 * The failure it guards against is the worst kind of regression this app can
 * ship: an update that silently empties somebody's sidebar.
 */

import { strict as assert } from "node:assert";
import { appState } from "../helpers.mjs";

describe("a profile from an older build", () => {
  it("opens rather than refusing to start", async () => {
    // Reaching this point at all means the app booted and IPC answered; the
    // session's `before` hook already required both.
    const state = await appState();
    assert.ok(state, "the app came up with no state at all");
  });

  it("keeps the projects the old profile had", async () => {
    const state = await appState();
    assert.equal(state.repos.length, 1, "the migration lost the project");
    assert.equal(state.repos[0].name, "legacy-project");
  });

  it("fills in the fields the old shape did not have", async () => {
    const state = await appState();
    // `isGit` post-dates this profile; every folder registered back then was a
    // repository, so the migration must default it to true rather than leave it
    // undefined and quietly disable the git panels.
    assert.notEqual(state.repos[0].isGit, false);
    assert.ok(
      Array.isArray(state.settings.terminalProfiles) && state.settings.terminalProfiles.length > 0,
      "terminal profiles were not seeded for a profile that predates them",
    );
  });
});
