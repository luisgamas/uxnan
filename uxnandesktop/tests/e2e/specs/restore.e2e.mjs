/**
 * A saved session comes back.
 *
 * The single most valuable thing an ADE can get wrong: you close it with work in
 * flight and reopen it to find an empty window. The unit tests cover the layout
 * serialisation; only this layer can show that the project is registered, the
 * workspace is bound to it, and a real shell is running in it again.
 */

import { strict as assert } from "node:assert";
import { appState, countOf, waitForProcesses, waitForTerminals } from "../helpers.mjs";

describe("restoring a saved session", () => {
  it("registers the project the previous session had open", async () => {
    const state = await appState();
    assert.equal(state.repos.length, 1);
    assert.equal(state.repos[0].name, "fixture-repo");
  });

  it("brings the terminal back and spawns a real shell in it", async () => {
    await waitForTerminals(1);
    // A mounted xterm proves the layout restored; a shell process under the app
    // proves something is actually attached to it. (xterm paints via WebGL, so
    // its text is not readable from the DOM — see helpers.mjs.)
    await waitForProcesses(
      (names) => countOf(["cmd.exe", "powershell.exe", "pwsh.exe", "bash.exe", "sh.exe"], names) >= 1,
      { label: "a shell process under the app" },
    );
  });

  it("binds the workspace to the restored worktree", async () => {
    // Asked over IPC: the sidebar's own label is localised, this is not.
    const state = await appState();
    const worktrees = state.repos[0].worktrees;
    assert.ok(worktrees.length >= 1, "the restored project has no worktree");
    assert.match(worktrees[0].path.split(/[\\/]/).pop(), /^repo/);
  });
});
