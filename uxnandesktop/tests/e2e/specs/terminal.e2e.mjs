/**
 * Two terminals in a split, both alive.
 *
 * Restoring one terminal and restoring a split are different code paths — the
 * region tree has to be rebuilt and each leaf given its own PTY. This is also
 * the cheapest end-to-end proof that the PTY layer works at all.
 *
 * "Alive" is asserted against the **process tree**, not against what the panes
 * show. xterm paints through WebGL, so its text is not in the DOM at all; a test
 * reading `.xterm-rows` would be asserting on an empty string and would pass or
 * fail for reasons that have nothing to do with the shell.
 */

import { strict as assert } from "node:assert";

import {
  appDescendants,
  countOf,
  terminalCount,
  waitForProcesses,
  waitForTerminals,
} from "../helpers.mjs";

/** Shells the app may have spawned, whichever profile is the platform default. */
const SHELLS = ["cmd.exe", "powershell.exe", "pwsh.exe", "bash.exe", "sh.exe"];

describe("terminals in a split", () => {
  it("mounts one terminal per region", async () => {
    await waitForTerminals(2);
    assert.equal(await terminalCount(), 2);
  });

  it("has a real shell process behind each pane", async () => {
    const tree = await waitForProcesses(
      (names) => countOf(SHELLS, names) >= 2,
      { label: "two shell processes under the app" },
    );
    assert.ok(
      countOf(SHELLS, tree) >= 2,
      `expected two shells under the app; the tree held: ${tree.join(", ")}`,
    );
  });

  it("keeps the two regions independent", async () => {
    // If the split had collapsed, the first assertion would have seen one
    // terminal; this guards the other direction — that no stray region appeared.
    assert.equal(await terminalCount(), 2);
    assert.ok(
      countOf(SHELLS, appDescendants()) <= 4,
      "more shell processes than panes — something spawned an extra one",
    );
  });
});
