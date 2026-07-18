import { describe, expect, it } from "vitest";
import { resumeCommand } from "./agentResume";

const at = 1;

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
