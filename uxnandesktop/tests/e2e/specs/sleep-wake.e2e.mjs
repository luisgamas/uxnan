/**
 * A slept workspace costs nothing until it is woken.
 *
 * Sleeping is the feature that makes many worktrees affordable, and its whole
 * value is that the processes really are gone. A restored-asleep tab that
 * quietly spawns its shell anyway would look identical in the UI and give the
 * memory back to nobody — which the resource benchmark measured, but only this
 * layer can attribute to the sleep flag.
 */

import { strict as assert } from "node:assert";
import { appState, terminalCount } from "../helpers.mjs";

describe("a workspace restored asleep", () => {
  it("restores the layout", async () => {
    const state = await appState();
    assert.equal(state.repos.length, 1, "the project should still be registered");
  });

  it("does not spawn shells for sleeping tabs", async () => {
    // Give the app the same window it would need to mount them, then assert it
    // did not: waiting is what makes this a real assertion rather than a race
    // that happens to pass.
    await browser.pause(8000);
    assert.equal(
      await terminalCount(),
      0,
      "a sleeping workspace mounted a terminal — sleep is giving nothing back",
    );
  });
});
