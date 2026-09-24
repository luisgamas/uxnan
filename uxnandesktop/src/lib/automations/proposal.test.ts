import { describe, expect, it } from "vitest";
import { buildProposal, scheduleFrom } from "./proposal";

const INSTALLED = ["claude", "codex"];
const id = () => "fixed-id";

function propose(over: Record<string, unknown> = {}) {
  return buildProposal(
    {
      name: "Nightly lint",
      workingDir: "/code/app",
      steps: [{ agent: "claude", prompt: "Run the linter." }],
      ...over,
    },
    INSTALLED,
    id,
  );
}

describe("buildProposal", () => {
  it("fills the draft the editor opens on, and leaves it paused", () => {
    const a = propose({ description: "keeps the tree clean", tags: ["quality", " "] });
    expect(a.id).toBe("fixed-id");
    expect(a.name).toBe("Nightly lint");
    expect(a.description).toBe("keeps the tree clean");
    expect(a.tags).toEqual(["quality"]);
    // The whole point: an agent's draft never starts running by itself, and
    // saving it does not start it either.
    expect(a.enabled).toBe(false);
    expect(a.createdAt).toBe(0);
    expect(a.updatedAt).toBe(0);
    expect(a.steps).toHaveLength(1);
    expect(a.steps[0]).toMatchObject({ id: "s1", agent: "claude", prompt: "Run the linter." });
    // Not something an agent may ask for: a step approves its own tools only
    // when it says so.
    expect(a.steps[0].autonomous).toBe(false);
  });

  it("numbers steps that bring no id and keeps the ones that do", () => {
    const a = propose({
      steps: [
        { agent: "claude", prompt: "read" },
        { id: "report", agent: "codex", prompt: "write", dependsOn: ["s1"] },
      ],
    });
    expect(a.steps.map((s) => s.id)).toEqual(["s1", "report"]);
    expect(a.steps[1].dependsOn).toEqual(["s1"]);
  });

  it("lets a step depend on one declared after it", () => {
    const a = propose({
      steps: [
        { id: "a", agent: "claude", prompt: "one", dependsOn: ["b"] },
        { id: "b", agent: "claude", prompt: "two" },
      ],
    });
    expect(a.steps[0].dependsOn).toEqual(["b"]);
  });

  it("carries the step's own settings through", () => {
    const a = propose({
      steps: [
        { agent: "codex", model: "gpt-5", prompt: "fix it", title: "Fix", autonomous: true },
      ],
    });
    expect(a.steps[0]).toMatchObject({
      agent: "codex",
      model: "gpt-5",
      title: "Fix",
      autonomous: true,
    });
  });

  it("refuses an agent this machine does not have, and says which it has", () => {
    expect(() => propose({ steps: [{ agent: "gpt", prompt: "x" }] })).toThrow(
      /no agent `gpt` is installed.*claude, codex/,
    );
  });

  it("refuses a draft that cannot be acted on", () => {
    expect(() => propose({ name: "  " })).toThrow(/needs a name/);
    expect(() => propose({ workingDir: "" })).toThrow(/working folder/);
    expect(() => propose({ steps: [] })).toThrow(/at least one step/);
    expect(() => propose({ steps: [{ agent: "claude", prompt: "  " }] })).toThrow(/no prompt/);
  });

  it("refuses references that would not mean what they say", () => {
    expect(() =>
      propose({
        steps: [
          { id: "s1", agent: "claude", prompt: "a" },
          { id: "s1", agent: "claude", prompt: "b" },
        ],
      }),
    ).toThrow(/share the id/);
    expect(() =>
      propose({ steps: [{ id: "a", agent: "claude", prompt: "x", dependsOn: ["a"] }] }),
    ).toThrow(/depends on itself/);
    expect(() =>
      propose({ steps: [{ id: "a", agent: "claude", prompt: "x", dependsOn: ["ghost"] }] }),
    ).toThrow(/`ghost`, which is not a step here/);
  });
});

describe("scheduleFrom", () => {
  it("takes each cadence and clamps what is out of range", () => {
    expect(scheduleFrom({ kind: "dailyAt", hour: 3, minute: 30 })).toEqual({
      kind: "dailyAt",
      hour: 3,
      minute: 30,
    });
    expect(scheduleFrom({ kind: "every", n: 2, unit: "hours" })).toEqual({
      kind: "every",
      n: 2,
      unit: "hours",
      startsAt: 0,
    });
    expect(scheduleFrom({ kind: "weeklyAt", day: 9, hour: 99, minute: -1 })).toEqual({
      kind: "weeklyAt",
      day: 6,
      hour: 23,
      minute: 0,
    });
  });

  it("falls back to a daily morning run rather than refusing the draft", () => {
    // A cadence that does not parse is the one thing worth *not* failing over:
    // the person is looking at the picker, and the prompts are the work.
    for (const bad of [undefined, null, "nightly", {}, { kind: "hourly" }]) {
      expect(scheduleFrom(bad)).toEqual({ kind: "dailyAt", hour: 9, minute: 0 });
    }
  });
});
