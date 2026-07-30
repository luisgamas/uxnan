import { describe, expect, it } from "vitest";
import { repairedSession, resumeCommand } from "./agentResume";

const at = 1;

describe("repairedSession", () => {
  // Golden shape: a Codex session captured on Windows while the since-removed
  // reporter was installed. Its type is the placeholder that reporter wrote, so
  // the tab offered no resume at all — the path is what still identifies it.
  const poisoned = {
    agent: "agent",
    id: "019faf53-ab10-7de0-a906-b96c9b4a472a",
    file: "\\\\?\\C:\\Users\\dev\\.codex\\sessions\\2026\\07\\29\\rollout-x.jsonl",
    live: true,
    capturedAt: at,
  };

  it("recovers the agent from the transcript path, and with it the resume", () => {
    expect(repairedSession(poisoned).agent).toBe("codex");
    expect(resumeCommand(repairedSession(poisoned))).toBe(
      "codex resume 019faf53-ab10-7de0-a906-b96c9b4a472a",
    );
    // Every CLI that reports a path, in either slash spelling.
    for (const [file, agent] of [
      ["C:/Users/dev/.claude/projects/x/t.jsonl", "claude"],
      ["/home/dev/.pi/agent/sessions/s.jsonl", "pi"],
      ["/home/dev/.grok/sessions/s.json", "grok"],
      ["/home/dev/.gemini/tmp/s.json", "gemini"],
    ] as const) {
      expect(repairedSession({ ...poisoned, file }).agent).toBe(agent);
    }
  });

  it("leaves a usable session exactly as it is", () => {
    const good = { agent: "claude", id: "abc", file: "/x/.codex/y.jsonl", capturedAt: at };
    // Never re-reads the path for a session that already names its agent — the
    // stored type is the provider's own word.
    expect(repairedSession(good)).toBe(good);
  });

  it("keeps a placeholder it cannot place rather than guessing", () => {
    // No path, or a path belonging to no known CLI: running the wrong CLI's
    // command line is worse than offering nothing.
    expect(repairedSession({ agent: "agent", id: "abc", capturedAt: at }).agent).toBe("agent");
    expect(
      repairedSession({ agent: "agent", id: "abc", file: "/tmp/x.jsonl", capturedAt: at }).agent,
    ).toBe("agent");
    expect(resumeCommand({ agent: "agent", id: "abc", capturedAt: at })).toBeNull();
  });
});

describe("resumeCommand", () => {
  it("builds the verified per-CLI resume invocations", () => {
    expect(resumeCommand({ agent: "claude", id: "3f9a-1c2e", capturedAt: at })).toBe(
      "claude --resume 3f9a-1c2e",
    );
    expect(resumeCommand({ agent: "codex", id: "abc123", capturedAt: at })).toBe(
      "codex resume abc123",
    );
    expect(resumeCommand({ agent: "opencode", id: "ses_01J0", capturedAt: at })).toBe(
      "opencode --session ses_01J0",
    );
    expect(resumeCommand({ agent: "grok", id: "01k2-abcd", capturedAt: at })).toBe(
      "grok --resume 01k2-abcd",
    );
    // Antigravity: the CLI is `agy`, and it reopens a conversation id.
    expect(resumeCommand({ agent: "antigravity", id: "0f6b9e14-77aa", capturedAt: at })).toBe(
      "agy --conversation 0f6b9e14-77aa",
    );
  });

  it("re-claims an id we named that the provider never wrote", () => {
    // Verified against the real CLIs: the two flags are complements, so a
    // session that was opened and never used is reopened by claiming its id
    // again — `--resume` would answer "No conversation found".
    expect(resumeCommand({ agent: "claude", id: "3f9a-1c2e", pending: true, capturedAt: at })).toBe(
      "claude --session-id 3f9a-1c2e",
    );
    expect(resumeCommand({ agent: "grok", id: "01k2-abcd", pending: true, capturedAt: at })).toBe(
      "grok --session-id 01k2-abcd",
    );
    // Pi's own `--session-id` creates the session if missing, file or not.
    expect(
      resumeCommand({ agent: "pi", id: "abc", file: "/s/1.jsonl", pending: true, capturedAt: at }),
    ).toBe("pi --session-id abc");
    // Antigravity's single flag both creates and reopens, so it doesn't branch.
    expect(
      resumeCommand({ agent: "antigravity", id: "0f6b-9e14", pending: true, capturedAt: at }),
    ).toBe("agy --conversation 0f6b-9e14");
  });

  it("treats a session with no `pending` flag as one the provider reported", () => {
    // Sessions persisted before ids were named at launch carry no flag; reading
    // that as "never written" would re-claim an id that is already in use.
    expect(resumeCommand({ agent: "claude", id: "old-1", capturedAt: at })).toBe(
      "claude --resume old-1",
    );
    expect(resumeCommand({ agent: "claude", id: "old-1", pending: false, capturedAt: at })).toBe(
      "claude --resume old-1",
    );
  });

  it("prefers the session file for pi, quoted as one argument", () => {
    expect(
      resumeCommand({
        agent: "pi",
        id: "abc",
        file: "C:/Users/dev/.pi/sessions/s 1.jsonl",
        capturedAt: at,
      }),
    ).toBe('pi --session "C:/Users/dev/.pi/sessions/s 1.jsonl"');
    expect(resumeCommand({ agent: "pi", id: "abc", capturedAt: at })).toBe("pi --session abc");
  });

  it("returns null for agents without a verified resume entry", () => {
    expect(resumeCommand({ agent: "gemini", id: "abc", capturedAt: at })).toBeNull();
    expect(resumeCommand({ agent: "zero", id: "abc", capturedAt: at })).toBeNull();
    expect(resumeCommand({ agent: "", id: "abc", capturedAt: at })).toBeNull();
  });

  it("rejects hostile ids and files instead of escaping them", () => {
    for (const id of ["-rm", "a b", "x;y", "x|y", 'x"y', "x`y`", "x$(y)", ""]) {
      expect(resumeCommand({ agent: "claude", id, capturedAt: at })).toBeNull();
    }
    // A hostile file falls back to the id, never into the command line.
    expect(resumeCommand({ agent: "pi", id: "ok1", file: 'bad"quote', capturedAt: at })).toBe(
      "pi --session ok1",
    );
    expect(
      resumeCommand({
        agent: "pi",
        id: "ok1",
        file: "bad" + String.fromCharCode(7) + "bell",
        capturedAt: at,
      }),
    ).toBe("pi --session ok1");
  });
});
