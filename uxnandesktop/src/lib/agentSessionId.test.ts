import { describe, expect, it } from "vitest";
import { ownedSession, renewPendingSession } from "./agentSessionId";
import { resumeCommand } from "./agentResume";

const ID = "0f6b9e14-77aa-4c1e-9f0e-2b3c4d5e6f70";
const fixed = () => ID;

describe("ownedSession", () => {
  it("pins the session for every CLI that accepts a caller-chosen id", () => {
    expect(ownedSession("claude", [], fixed)).toEqual({
      agent: "claude",
      id: ID,
      args: ["--session-id", ID],
    });
    expect(ownedSession("grok", [], fixed)?.args).toEqual(["--session-id", ID]);
    expect(ownedSession("pi", [], fixed)?.args).toEqual(["--session-id", ID]);
    // Antigravity's CLI is `agy`, and it names a *conversation*.
    expect(ownedSession("agy", [], fixed)).toEqual({
      agent: "antigravity",
      id: ID,
      args: ["--conversation", ID],
    });
  });

  it("produces an id the resume registry can actually reopen", () => {
    // The two tables join on `agent`; a drift between them would silently make
    // every owned session unresumable.
    for (const command of ["claude", "grok", "pi", "agy"]) {
      const owned = ownedSession(command, [], fixed);
      expect(owned).not.toBeNull();
      expect(
        resumeCommand({ agent: owned!.agent, id: owned!.id, capturedAt: 1 }),
      ).not.toBeNull();
    }
  });

  it("leaves alone the CLIs that expose no such flag", () => {
    expect(ownedSession("codex", [], fixed)).toBeNull();
    expect(ownedSession("opencode", [], fixed)).toBeNull();
    expect(ownedSession("unknown", [], fixed)).toBeNull();
    expect(ownedSession("", [], fixed)).toBeNull();
  });

  it("reads the executable through a path, extension and casing", () => {
    expect(ownedSession("C:\\tools\\Claude.CMD", [], fixed)?.agent).toBe("claude");
    expect(ownedSession("/usr/local/bin/claude", [], fixed)?.agent).toBe("claude");
  });

  it("re-mints an unwritten session's id, keeping everything else", () => {
    const renewed = renewPendingSession(
      { agent: "claude", id: "old", live: true, pending: true, capturedAt: 1 },
      () => ID,
      () => 99,
    );
    expect(renewed).toEqual({
      agent: "claude",
      id: ID,
      live: true,
      pending: true,
      capturedAt: 99,
    });
  });

  it("never pins on top of args that already choose a session", () => {
    for (const args of [
      ["--continue"],
      ["-c"],
      ["--resume", "abc"],
      ["--session-id", "mine"],
      ["--session=abc"],
      ["--fork-session"],
      ["--conversation", "abc"],
    ]) {
      expect(ownedSession("claude", args, fixed)).toBeNull();
    }
    // An unrelated arg is no reason to skip it.
    expect(ownedSession("claude", ["--model", "opus"], fixed)?.args).toEqual([
      "--session-id",
      ID,
    ]);
  });
});
