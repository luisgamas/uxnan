import { describe, expect, it } from "vitest";
import {
  activityFailed,
  activityRunning,
  changedFiles,
  formatElapsed,
  groupParts,
  isActivity,
  requestIdOf,
  splitAnswer,
  summarizeWork,
  textOf,
} from "./timeline";

const cmd = (command: string, extra: Record<string, unknown> = {}) => ({
  type: "command_execution",
  command,
  ...extra,
});
const diff = (filename: string, additions = 1, deletions = 0) => ({
  type: "diff",
  filename,
  additions,
  deletions,
});
const text = (t: string) => ({ type: "text", text: t });

describe("textOf / isActivity", () => {
  it("reads text runs and tells activity from everything else", () => {
    expect(textOf(text("hi"))).toBe("hi");
    expect(textOf({ type: "text" })).toBeNull();
    expect(textOf(null)).toBeNull();
    expect(isActivity(cmd("ls"))).toBe(true);
    expect(isActivity({ type: "subagent" })).toBe(true);
    expect(isActivity({ type: "approval" })).toBe(false);
    expect(isActivity("nonsense")).toBe(false);
  });
});

describe("groupParts", () => {
  it("folds consecutive activity into one work item and keeps the order", () => {
    const items = groupParts([
      text("Looking."),
      cmd("ls"),
      diff("a.ts"),
      { type: "approval", approvalId: "x" },
      cmd("npm test"),
      text("Done."),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["text", "work", "block", "work", "text"]);
    expect(items[1]).toMatchObject({ kind: "work", blocks: [{ command: "ls" }, { filename: "a.ts" }] });
  });

  it("keeps an answer that closes with a response boundary as the answer", () => {
    const boundary = { type: "assistant_response_boundary", phase: "unknown" };
    const items = groupParts([cmd("cat a.ts"), text("It builds the blocks."), boundary]);
    expect(items.map((i) => i.kind)).toEqual(["work", "text"]);
    expect(splitAnswer(items).answer).toEqual([{ kind: "text", text: "It builds the blocks." }]);
  });

  it("keeps only the latest of a turn's plans, in its place", () => {
    const plan = (done: boolean) => ({
      type: "plan",
      state: { steps: [{ description: "a", status: done ? "completed" : "pending" }] },
    });
    const items = groupParts([plan(false), cmd("ls"), plan(true), text("Done.")]);
    expect(items.map((i) => i.kind)).toEqual(["work", "block", "text"]);
    expect(items[1]).toEqual({ kind: "block", block: plan(true) });
  });

  it("drops blank text and passes unknown shapes through as lone blocks", () => {
    const items = groupParts([text("  \n"), 42, { type: "future-kind" }]);
    expect(items).toEqual([
      { kind: "block", block: 42 },
      { kind: "block", block: { type: "future-kind" } },
    ]);
  });
});

describe("splitAnswer", () => {
  it("keeps the text after the last block as the answer", () => {
    const items = groupParts([text("plan"), cmd("ls"), text("It works."), text("Ship it.")]);
    const { work, answer } = splitAnswer(items);
    expect(work.map((i) => i.kind)).toEqual(["text", "work"]);
    expect(answer).toEqual([{ kind: "text", text: "It works." }, { kind: "text", text: "Ship it." }]);
  });

  it("treats a turn without blocks as all answer, and one ending on a block as all work", () => {
    expect(splitAnswer(groupParts([text("just text")])).work).toEqual([]);
    expect(splitAnswer(groupParts([text("a"), cmd("ls")])).answer).toEqual([]);
  });
});

describe("activity state", () => {
  it("recognizes failures from the status, the exit code and a tool error", () => {
    expect(activityFailed(cmd("x", { exitCode: 1 }))).toBe(true);
    expect(activityFailed(cmd("x", { exitCode: 0 }))).toBe(false);
    expect(activityFailed(cmd("x", { status: "error" }))).toBe(true);
    expect(activityFailed({ type: "tool", isError: true })).toBe(true);
    expect(activityFailed({ type: "subagent", state: { status: "error" } })).toBe(true);
    expect(activityFailed({ type: "subagent", state: { status: "completed" } })).toBe(false);
  });

  it("recognizes running steps, a subagent's nested state included", () => {
    expect(activityRunning(cmd("x", { status: "running" }))).toBe(true);
    expect(activityRunning({ type: "subagent", state: { status: "in_progress" } })).toBe(true);
    expect(activityRunning(cmd("x", { status: "completed" }))).toBe(false);
  });
});

describe("summarizeWork", () => {
  it("counts each kind of step and the failed ones", () => {
    expect(
      summarizeWork([
        cmd("a"),
        cmd("b", { exitCode: 2 }),
        diff("f"),
        { type: "tool", toolName: "Read" },
        { type: "subagent" },
      ]),
    ).toEqual({ commands: 2, edits: 1, tools: 1, agents: 1, failed: 1 });
  });
});

describe("changedFiles", () => {
  it("lists each file once, in first-touched order, with summed line counts", () => {
    expect(
      changedFiles([diff("b.ts", 2, 1), text("x"), diff("a.ts", 5), diff("b.ts", 3, 4), { type: "diff" }]),
    ).toEqual([
      { filename: "b.ts", additions: 5, deletions: 5 },
      { filename: "a.ts", additions: 5, deletions: 0 },
    ]);
  });
});

describe("requestIdOf", () => {
  it("reads an approval's or a question's id, flat or nested under request", () => {
    expect(requestIdOf({ type: "approval", approvalId: "a1" })).toBe("a1");
    expect(requestIdOf({ type: "question", request: { questionId: "q1" } })).toBe("q1");
    expect(requestIdOf({ type: "approval", questionId: "q1" })).toBe("");
    expect(requestIdOf({ type: "diff" })).toBe("");
    expect(requestIdOf(null)).toBe("");
  });
});

describe("formatElapsed", () => {
  it("formats seconds, minutes and hours, and never goes negative", () => {
    expect(formatElapsed(-5)).toBe("0s");
    expect(formatElapsed(45_400)).toBe("45s");
    expect(formatElapsed(63_000)).toBe("1m 3s");
    expect(formatElapsed(2 * 3_600_000 + 5 * 60_000)).toBe("2h 5m");
  });
});
