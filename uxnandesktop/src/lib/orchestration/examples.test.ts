import { describe, it, expect } from "vitest";
import { buildExampleRun, type ExampleStepSpec } from "./examples";

describe("buildExampleRun", () => {
  const steps: ExampleStepSpec[] = [
    { title: "One", kind: "headless", prompt: "read the readme", dependsOn: [] },
    { title: "Gate", kind: "gate", prompt: "approve?", dependsOn: [0] },
    { title: "Three", kind: "headless", prompt: "use {{steps.s1.output}}", dependsOn: [0, 1] },
  ];

  it("mints sequential ids and maps dependency indices onto them", () => {
    const run = buildExampleRun("r1", "Example", steps, { agent: "codex", workspace: "/w", now: 1000 });
    expect(run.status).toBe("draft");
    expect(run.title).toBe("Example");
    expect(run.steps.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(run.steps[1].dependsOn).toEqual(["s1"]);
    expect(run.steps[2].dependsOn).toEqual(["s1", "s2"]);
  });

  it("targets headless steps with the chosen agent+workspace; gates get a question, no target", () => {
    const run = buildExampleRun("r1", "Example", steps, { agent: "codex", workspace: "/w", now: 1000 });
    expect(run.steps[0].kind).toBe("headless");
    expect(run.steps[0].target).toEqual({ agent: "codex", model: "", workspace: "/w" });
    expect(run.steps[1].kind).toBe("gate");
    expect(run.steps[1].target).toEqual({});
    expect(run.steps[1].gate).toEqual({ question: "approve?" });
    // Chained prompt kept verbatim (the token lines up with the minted s1 id).
    expect(run.steps[2].prompt).toContain("{{steps.s1.output}}");
  });
});
