import { describe, it, expect } from "vitest";
import { statusFromTitle } from "./agentTitle";

describe("statusFromTitle", () => {
  it("maps recognizable status words", () => {
    expect(statusFromTitle("Codex is thinking…")).toBe("working");
    expect(statusFromTitle("Waiting for your input")).toBe("waiting");
    expect(statusFromTitle("Claude: done.")).toBe("done");
    expect(statusFromTitle("Build failed")).toBe("blocked");
  });

  it("resolves the most attention-worthy state first", () => {
    // "error" (blocked) outranks a trailing "done".
    expect(statusFromTitle("error — task not done")).toBe("blocked");
  });

  it("matches trailing ellipsis / check glyphs", () => {
    expect(statusFromTitle("Generating response...")).toBe("working");
    expect(statusFromTitle("Task ✓")).toBe("done");
  });

  it("ignores keywords embedded in a path segment (no false positive)", () => {
    // The keyword sits after a path separator — must NOT mint a status.
    expect(statusFromTitle("~/codex/ready")).toBeNull();
    expect(statusFromTitle("C:\\proj\\working")).toBeNull();
    expect(statusFromTitle("codex.done")).toBeNull();
    expect(statusFromTitle("/home/u/error-logs")).toBeNull();
  });

  it("ignores keywords embedded in a longer word", () => {
    expect(statusFromTitle("already there")).toBeNull(); // ⊃ ready
    expect(statusFromTitle("reworking the plan")).toBeNull(); // ⊃ working
    expect(statusFromTitle("overthinking it")).toBeNull(); // ⊃ thinking
  });

  it("returns null for a plain cwd / prompt title", () => {
    expect(statusFromTitle("user@host: ~/projects/app")).toBeNull();
    expect(statusFromTitle("")).toBeNull();
  });
});
