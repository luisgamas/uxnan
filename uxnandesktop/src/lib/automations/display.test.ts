import { describe, expect, it } from "vitest";
import {
  agentsOf,
  filterAutomations,
  folderLabel,
  frequencyBucket,
  groupAutomations,
  isScheduled,
  primaryAgent,
  runProgress,
  runStatusDot,
} from "./display";
import { newAutomation, newStep, nextStepId } from "./types";
import type { Automation, AutomationRun, Step } from "./types";

function step(id: string, agent: string, deps: string[] = []): Step {
  return { ...newStep(id, agent), dependsOn: deps, title: `Step ${id}` };
}

function automation(name: string, steps: Step[], extra: Partial<Automation> = {}): Automation {
  return { ...newAutomation(name.toLowerCase(), name, "C:/work/repo"), steps, ...extra };
}

describe("agents", () => {
  it("lists every distinct agent an automation drives, in order", () => {
    const a = automation("Triage", [
      step("s1", "opencode"),
      step("s2", "codex"),
      step("s3", "claude", ["s1", "s2"]),
      step("s4", "codex", ["s3"]),
    ]);
    expect(agentsOf(a)).toEqual(["opencode", "codex", "claude"]);
  });

  it("treats the first dependency-free step as the lead agent", () => {
    // The consolidating step runs last, so it must not be shown as the one
    // that leads the automation.
    const a = automation("Triage", [
      step("s3", "claude", ["s1"]),
      step("s1", "opencode"),
    ]);
    expect(primaryAgent(a)).toBe("opencode");
  });

  it("falls back to the first step when everything has a dependency", () => {
    const a = automation("Odd", [step("s1", "pi", ["s2"]), step("s2", "claude", ["s1"])]);
    expect(primaryAgent(a)).toBe("pi");
  });

  it("has no agents when there are no steps", () => {
    expect(agentsOf(automation("Empty", []))).toEqual([]);
    expect(primaryAgent(automation("Empty", []))).toBe("");
  });
});

describe("grouping", () => {
  const triage = automation("Triage", [step("s1", "opencode")], { tags: ["review"] });
  const audit = automation("Audit", [step("s1", "claude")], { tags: ["review", "security"] });
  const loose = automation("Loose", [step("s1", "claude")], { tags: [] });

  it("groups by lead agent", () => {
    const groups = groupAutomations([triage, audit], "agent");
    expect(groups.map((g) => g.key)).toEqual(["claude", "opencode"]);
    expect(groups[0].items.map((a) => a.name)).toEqual(["Audit"]);
  });

  it("puts a multi-tag automation in each of its tags", () => {
    const groups = groupAutomations([triage, audit], "tag");
    const review = groups.find((g) => g.key === "review");
    expect(review?.items.map((a) => a.name)).toEqual(["Audit", "Triage"]);
    expect(groups.find((g) => g.key === "security")?.items).toHaveLength(1);
  });

  it("sinks the catch-all bucket to the bottom", () => {
    const groups = groupAutomations([loose, audit], "tag", { unassignedKey: "—" });
    expect(groups.at(-1)?.key).toBe("—");
  });

  it("sorts automations inside a group by name so the list never reshuffles", () => {
    const z = automation("Zeta", [step("s1", "claude")]);
    const a = automation("Alpha", [step("s1", "claude")]);
    const [group] = groupAutomations([z, a], "agent");
    expect(group.items.map((x) => x.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("buckets frequencies coarsely so near-identical cadences group together", () => {
    expect(frequencyBucket({ kind: "every", n: 15, unit: "minutes", startsAt: 0 })).toBe(
      frequencyBucket({ kind: "every", n: 30, unit: "minutes", startsAt: 0 }),
    );
    expect(frequencyBucket({ kind: "dailyAt", hour: 9, minute: 0 })).toBe(
      "automations.freqDaily",
    );
    expect(frequencyBucket({ kind: "weeklyAt", day: 1, hour: 9, minute: 0 })).toBe(
      "automations.freqWeekly",
    );
  });

  it("groups by folder using its last segment as the label", () => {
    const other = automation("Other", [step("s1", "claude")], { workingDir: "D:/docs/notes" });
    const groups = groupAutomations([other], "folder");
    expect(groups[0].label).toBe("notes");
  });
});

describe("folder labels", () => {
  it("handles both separators and a trailing one", () => {
    expect(folderLabel("C:/work/repo")).toBe("repo");
    expect(folderLabel("C:\\work\\repo")).toBe("repo");
    expect(folderLabel("C:/work/repo/")).toBe("repo");
    expect(folderLabel("repo")).toBe("repo");
  });
});

describe("search", () => {
  const a = automation("Nightly triage", [step("s1", "opencode")], {
    tags: ["review"],
    description: "Looks at failing tests",
  });

  it("matches name, description, tag, folder and agent", () => {
    for (const q of ["nightly", "failing", "review", "repo", "opencode"]) {
      expect(filterAutomations([a], q)).toHaveLength(1);
    }
    expect(filterAutomations([a], "nothing-here")).toHaveLength(0);
  });

  it("ignores case and surrounding space, and an empty query keeps everything", () => {
    expect(filterAutomations([a], "  NIGHTLY  ")).toHaveLength(1);
    expect(filterAutomations([a], "   ")).toHaveLength(1);
  });
});

describe("run presentation", () => {
  function run(partial: Partial<AutomationRun>): AutomationRun {
    return {
      id: "r1",
      automationId: "a1",
      automationName: "Triage",
      trigger: "scheduled",
      status: "completed",
      workingDir: "C:/work",
      startedAt: 0,
      steps: [],
      ...partial,
    };
  }

  it("counts only completed steps as progress", () => {
    const r = run({
      steps: [
        { ...stepRun("s1"), status: "completed" },
        { ...stepRun("s2"), status: "failed" },
        { ...stepRun("s3"), status: "skipped" },
      ],
    });
    expect(runProgress(r)).toEqual({ done: 1, total: 3 });
  });

  it("keeps a skipped run out of the alarming colour", () => {
    // A skipped run is the policy working, not a failure to shout about.
    expect(runStatusDot("failed")).toContain("red");
    expect(runStatusDot("skippedPrecondition")).not.toContain("red");
    expect(runStatusDot("skippedOverlap")).not.toContain("red");
    expect(runStatusDot("running")).toContain("animate-pulse");
  });
});

describe("scheduler status", () => {
  it("treats only a registered task as actually scheduled", () => {
    expect(isScheduled({ kind: "registered" })).toBe(true);
    expect(isScheduled({ kind: "absent" })).toBe(false);
    expect(isScheduled({ kind: "unsupported" })).toBe(false);
    expect(isScheduled({ kind: "failed", message: "Access is denied." })).toBe(false);
    expect(isScheduled(undefined)).toBe(false);
  });
});

describe("step ids", () => {
  it("never reuses a deleted id", () => {
    // Reusing `s2` would silently repoint an existing {{steps.s2.output}}.
    const steps = [newStep("s1"), newStep("s2"), newStep("s3")];
    const afterDelete = steps.filter((s) => s.id !== "s2");
    expect(nextStepId(afterDelete)).toBe("s4");
  });

  it("starts at s1 for an empty graph", () => {
    expect(nextStepId([])).toBe("s1");
  });
});

function stepRun(id: string) {
  return {
    id,
    title: id,
    agent: "claude",
    model: "",
    dependsOn: [],
    status: "pending" as const,
    prompt: "",
    missingRefs: [],
    output: "",
    stderr: "",
    attempts: 0,
  };
}
