/**
 * An agent running in a terminal, and the hook chain behind its status.
 *
 * Two separate things, deliberately asserted separately.
 *
 * **The agent runs where it should.** A CLI launched from a tab must end up as a
 * child of a shell, not of the app: that nesting is what tells uxnan the process
 * is the *user's* rather than its own, and it is what keeps an agent's memory out
 * of uxnan's own figure in the resource benchmark.
 *
 * **A report reaches the state the sidebar reads.** The report is posted here
 * over HTTP, exactly as a reporter does, using the coordinates the app wrote into
 * its own profile. That covers the part uxnan owns — the local server, the token,
 * the model update, the command the UI calls — without depending on a particular
 * CLI's reporter being installed and correct, which is a different question and
 * belongs to a different layer.
 */

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";

import {
  appDescendants,
  closeAppAndWait,
  countOf,
  invoke,
  PROFILE_DATA,
  waitForProcesses,
  waitForTerminals,
} from "../helpers.mjs";

/** The live hook coordinates, from the endpoint file the app writes at startup. */
function hookEndpoint() {
  const file = path.join(PROFILE_DATA, "hooks", "endpoint.cmd");
  const text = fs.readFileSync(file, "utf8");
  const url = text.match(/UXNAN_HOOK_URL=(\S+)/)?.[1];
  const token = text.match(/UXNAN_HOOK_TOKEN=(\S+)/)?.[1];
  if (!url || !token) throw new Error(`could not read hook coordinates from ${file}`);
  return { url, token };
}

describe("an agent working in a terminal", () => {
  it("launches the agent inside a shell, as the app does", async () => {
    await waitForTerminals(1);

    const tree = await waitForProcesses(
      (names) => countOf(["node.exe"], names) >= 1 && countOf(["cmd.exe", "sh.exe"], names) >= 1,
      { label: "the fixture agent running inside a shell" },
    );
    assert.ok(countOf(["node.exe"], tree) >= 1, "the fixture agent never started");
  });

  it("writes live hook coordinates into its own profile", () => {
    // The endpoint file is how a reporter finds the server again after a
    // restart. If it goes missing, every agent in the app goes silent.
    const { url, token } = hookEndpoint();
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/hook$/);
    assert.ok(token.length > 8, "the hook token is too short to be a real one");
  });

  it("rejects a report that does not carry the token", async () => {
    // The token is what stops any other local process from writing into the
    // agent status a user is reading.
    const { url } = hookEndpoint();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Uxnan-Token": "not-the-token",
        "X-Uxnan-Agent-Id": "e2e",
        "X-Uxnan-Agent-Type": "claude",
        "X-Uxnan-Status": "working",
      },
      body: "{}",
    });
    assert.ok(!response.ok, `an unauthenticated report was accepted (${response.status})`);
  });

  it("records a reported state where the sidebar reads it", async () => {
    const { url, token } = hookEndpoint();
    const agentId = "e2e-agent-journey";

    // Reported through the headers the shell reporters use — `X-Uxnan-Agent-Id`,
    // `-Agent-Type`, `-Status` — rather than an invented JSON body. Guessing the
    // body shape is how this test first "passed" a POST the server accepted and
    // then ignored.
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Uxnan-Token": token,
        "X-Uxnan-Agent-Id": agentId,
        "X-Uxnan-Agent-Type": "claude",
        "X-Uxnan-Status": "working",
      },
      body: "{}",
    });
    assert.ok(response.ok, `the hook server refused a valid report (${response.status})`);

    // `agent_states` is the same command the sidebar calls.
    let states = [];
    await browser.waitUntil(
      async () => {
        states = await invoke("agent_states");
        return states.some((s) => s.agentId === agentId);
      },
      {
        timeout: 20_000,
        interval: 500,
        timeoutMsg: "the report never reached the state the UI reads",
      },
    );

    const entry = states.find((s) => s.agentId === agentId);
    assert.equal(entry.status, "working");
    assert.equal(entry.agentType, "claude");
  });

  // Last, because it closes the app: everything above needs it running.
  it("takes the agent down with it when the window closes", async () => {
    // The failure this guards against is silent and permanent: the app exits,
    // the agent it started keeps running, and the only sign is a `node` process
    // nobody can account for — burning CPU, holding a worktree, and, on this
    // platform, blocking the next benchmark run.
    const before = appDescendants();
    assert.ok(countOf(["node.exe"], before) >= 1, "the agent was not running before the close");

    const gone = await closeAppAndWait();
    assert.ok(gone, `the app's tree survived a close request: ${appDescendants().join(", ")}`);
    assert.equal(
      countOf(["node.exe", "cmd.exe"], appDescendants()),
      0,
      "the agent outlived the app that started it",
    );
  });
});
