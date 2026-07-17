import { describe, expect, it } from "vitest";
import {
  addStep,
  createRun,
  deriveRunStatus,
  hasCycle,
  isRunTerminal,
  isStepTerminal,
  newStep,
  nextStatusForPending,
  readySteps,
  referencedStepIds,
  resolveTemplate,
  stepsById,
  validateRun,
  type Run,
  type RunStep,
  type StepStatus,
} from "./run";

/** Build a step with an explicit status + deps, defaults filled in. */
function step(id: string, status: StepStatus, dependsOn: string[] = []): RunStep {
  return { ...newStep(id, { dependsOn }), status };
}

/** Assemble a run from ready-made steps. */
function runOf(steps: RunStep[]): Run {
  return { ...createRun("r", "R", 0), steps, seq: steps.length };
}

describe("nextStatusForPending", () => {
  it("promotes a root (no deps) straight to ready", () => {
    const s = step("s1", "pending");
    expect(nextStatusForPending(s, { s1: s })).toBe("ready");
  });

  it("keeps a step pending until every dependency completes (fan-in)", () => {
    const a = step("s1", "completed");
    const b = step("s2", "running");
    const c = step("s3", "pending", ["s1", "s2"]);
    const by = { s1: a, s2: b, s3: c };
    // s2 not done yet → C stays pending.
    expect(nextStatusForPending(c, by)).toBeNull();
    // Both done → C becomes ready.
    b.status = "completed";
    expect(nextStatusForPending(c, by)).toBe("ready");
  });

  it("skips a step whose dependency failed or was skipped", () => {
    const a = step("s1", "failed");
    const c = step("s2", "pending", ["s1"]);
    expect(nextStatusForPending(c, { s1: a, s2: c })).toBe("skipped");
    a.status = "skipped";
    expect(nextStatusForPending(c, { s1: a, s2: c })).toBe("skipped");
  });

  it("only advances pending steps", () => {
    const s = step("s1", "running");
    expect(nextStatusForPending(s, { s1: s })).toBeNull();
  });
});

describe("deriveRunStatus", () => {
  it("is running while any step is non-terminal", () => {
    expect(deriveRunStatus(runOf([step("s1", "completed"), step("s2", "running")]))).toBe(
      "running",
    );
  });

  it("completes when all steps are terminal and none failed", () => {
    expect(deriveRunStatus(runOf([step("s1", "completed"), step("s2", "skipped")]))).toBe(
      "completed",
    );
  });

  it("fails when all steps are terminal and one failed", () => {
    expect(deriveRunStatus(runOf([step("s1", "completed"), step("s2", "failed")]))).toBe(
      "failed",
    );
  });

  it("an empty run derives to completed", () => {
    expect(deriveRunStatus(runOf([]))).toBe("completed");
  });
});

describe("readySteps", () => {
  it("returns only the ready steps", () => {
    const r = runOf([step("s1", "ready"), step("s2", "pending"), step("s3", "ready")]);
    expect(readySteps(r).map((s) => s.id)).toEqual(["s1", "s3"]);
  });
});

describe("hasCycle", () => {
  it("accepts a DAG (A+B → C)", () => {
    const r = runOf([
      step("s1", "pending"),
      step("s2", "pending"),
      step("s3", "pending", ["s1", "s2"]),
    ]);
    expect(hasCycle(r.steps)).toBe(false);
  });

  it("detects a cycle", () => {
    const r = runOf([
      step("s1", "pending", ["s2"]),
      step("s2", "pending", ["s1"]),
    ]);
    expect(hasCycle(r.steps)).toBe(true);
  });

  it("detects a self-loop", () => {
    expect(hasCycle([step("s1", "pending", ["s1"])])).toBe(true);
  });
});

describe("validateRun", () => {
  it("flags an empty run", () => {
    expect(validateRun(runOf([]))).toEqual(["A run needs at least one step."]);
  });

  it("flags a self-dependency, a missing dep, and a cycle", () => {
    const r = runOf([
      step("s1", "pending", ["s1"]), // self
      step("s2", "pending", ["ghost"]), // missing
    ]);
    const errs = validateRun(r);
    expect(errs.some((e) => e.includes("depends on itself"))).toBe(true);
    expect(errs.some((e) => e.includes("missing step"))).toBe(true);
  });

  it("passes a valid chain", () => {
    const r = runOf([step("s1", "pending"), step("s2", "pending", ["s1"])]);
    expect(validateRun(r)).toEqual([]);
  });
});

describe("resolveTemplate", () => {
  it("substitutes output / summary / title references", () => {
    const s1 = { ...step("s1", "completed"), title: "Analyze", output: "full out", summary: "short" };
    const by = { s1 };
    const r = resolveTemplate(
      "Prev said: {{steps.s1.output}} / {{ steps.s1.summary }} / {{steps.s1.title}}",
      by,
    );
    expect(r.text).toBe("Prev said: full out / short / Analyze");
    expect(r.missing).toEqual([]);
  });

  it("falls back summary→output when no summary was captured", () => {
    const s1 = { ...step("s1", "completed"), output: "the output" };
    const r = resolveTemplate("{{steps.s1.summary}}", { s1 });
    expect(r.text).toBe("the output");
  });

  it("substitutes an empty string and records missing refs", () => {
    const s1 = step("s1", "running"); // no output yet
    const r = resolveTemplate("A={{steps.s1.output}} B={{steps.ghost.output}}", { s1 });
    expect(r.text).toBe("A= B=");
    expect(r.missing).toEqual(["s1.output", "ghost.output"]);
  });
});

describe("referencedStepIds", () => {
  it("returns deduped ids in first-seen order", () => {
    expect(
      referencedStepIds("{{steps.s2.output}} {{steps.s1.summary}} {{steps.s2.title}}"),
    ).toEqual(["s2", "s1"]);
  });
});

describe("addStep", () => {
  it("mints sequential s<n> ids and bumps seq without reuse", () => {
    let run = createRun("r", "R", 0);
    const a = addStep(run, { title: "A" });
    expect(a.stepId).toBe("s1");
    const b = addStep(a.run, { title: "B", dependsOn: ["s1"] });
    expect(b.stepId).toBe("s2");
    // Removing s1 then adding again must not reuse "s1".
    const pruned: Run = { ...b.run, steps: b.run.steps.filter((s) => s.id !== "s1") };
    const c = addStep(pruned, { title: "C" });
    expect(c.stepId).toBe("s3");
    expect(c.run.seq).toBe(3);
  });

  it("defaults maxAttempts to 2 for a retry step, 1 otherwise", () => {
    expect(newStep("s1", {}).maxAttempts).toBe(1);
    expect(newStep("s2", { onFailure: "retry" }).maxAttempts).toBe(2);
  });
});

describe("terminal helpers", () => {
  it("classifies terminal step + run statuses", () => {
    expect(isStepTerminal("completed")).toBe(true);
    expect(isStepTerminal("running")).toBe(false);
    expect(isRunTerminal("cancelled")).toBe(true);
    expect(isRunTerminal("paused")).toBe(false);
  });
});

describe("stepsById", () => {
  it("indexes steps by id", () => {
    const r = runOf([step("s1", "ready"), step("s2", "pending")]);
    expect(Object.keys(stepsById(r))).toEqual(["s1", "s2"]);
  });
});
