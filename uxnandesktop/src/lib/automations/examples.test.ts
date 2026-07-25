import { describe, expect, it } from "vitest";
import { EXAMPLES, assignAgents, buildAllExamples, buildExample } from "./examples";
import { validateSchedule } from "./schedule";
import { en } from "$lib/i18n/locales/en";
import type { MessageKey } from "$lib/i18n/locales/en";

/** The **real** English catalogue. Using it rather than a stand-in means these
 *  tests check the prompts that actually ship — a `{{steps…}}` reference is only
 *  worth asserting against the text a user will really send. */
const t = (key: MessageKey) => en[key];

const opts = {
  installedAgents: ["claude", "codex", "opencode"],
  workingDir: "C:/work/repo",
  t,
  now: 1_700_000_000_000,
};

describe("the shipped examples", () => {
  it("are all paused, so nothing fires just because uxnan was opened", () => {
    for (const a of buildAllExamples(opts)) {
      expect(a.enabled, `${a.id} would start on its own`).toBe(false);
    }
  });

  it("have stable ids, so re-adding one replaces it instead of duplicating", () => {
    const ids = EXAMPLES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(buildAllExamples(opts).map((a) => a.id)).toEqual(ids);
  });

  it("are every one of them multi-agent", () => {
    // A single agent on a timer is precisely what this feature is not; an
    // example that looked like that would teach the wrong model.
    for (const a of buildAllExamples(opts)) {
      const agents = new Set(a.steps.map((s) => s.agent));
      expect(a.steps.length, `${a.id} has too few steps`).toBeGreaterThan(1);
      expect(agents.size, `${a.id} uses only one agent`).toBeGreaterThan(1);
    }
  });

  it("declare dependencies that exist and point backwards", () => {
    for (const a of buildAllExamples(opts)) {
      const seen = new Set<string>();
      for (const step of a.steps) {
        for (const dep of step.dependsOn) {
          expect(seen, `${a.id}/${step.id} depends on ${dep}`).toContain(dep);
        }
        seen.add(step.id);
      }
    }
  });

  it("only reference steps they wait for", () => {
    // A prompt quoting a step it does not depend on is the classic way to get
    // an empty hand-off — an example must not ship with that mistake.
    for (const a of buildAllExamples(opts)) {
      for (const step of a.steps) {
        for (const m of step.prompt.matchAll(/\{\{\s*steps\.(\w+)\./g)) {
          expect(step.dependsOn, `${a.id}/${step.id} quotes ${m[1]} unawaited`).toContain(m[1]);
        }
      }
    }
  });

  it("actually chain: a later step plants an earlier one's output", () => {
    // Without this the examples would look multi-agent while each step worked
    // in isolation, which teaches the opposite of the point.
    const chaining = buildAllExamples(opts).filter((a) =>
      a.steps.some((s) => /\{\{\s*steps\.\w+\./.test(s.prompt)),
    );
    expect(chaining.length).toBe(EXAMPLES.length);
  });

  it("has one example that carries context across runs", () => {
    const withPrev = buildAllExamples(opts).filter((a) =>
      a.steps.some((s) => /\{\{\s*prev\.\w+\./.test(s.prompt)),
    );
    expect(withPrev.length).toBeGreaterThan(0);
  });

  it("names and describes every example in the shipped catalogue", () => {
    // A missing key would render as the raw key in the list.
    for (const a of buildAllExamples(opts)) {
      expect(a.name.trim().length, `${a.id} has no name`).toBeGreaterThan(0);
      expect(a.description.trim().length, `${a.id} has no description`).toBeGreaterThan(0);
      expect(a.name.startsWith("automations."), `${a.id} name is a raw key`).toBe(false);
      for (const step of a.steps) {
        expect(step.prompt.startsWith("automations."), `${step.id} prompt is a raw key`).toBe(
          false,
        );
      }
    }
  });

  it("carry a schedule the backend will accept", () => {
    for (const a of buildAllExamples(opts)) {
      expect(validateSchedule(a.schedule), `${a.id}`).toEqual([]);
    }
  });

  it("never approve their own tools", () => {
    // Examples are read-and-report by design: an example that could edit files
    // unattended is not a safe thing to ship enabled-by-one-click.
    for (const a of buildAllExamples(opts)) {
      expect(a.steps.every((s) => !s.autonomous), `${a.id}`).toBe(true);
    }
  });

  it("gives one example a precondition, since that is a concept to show", () => {
    const withGate = buildAllExamples(opts).filter((a) => a.policy.precondition);
    expect(withGate.length).toBeGreaterThan(0);
    expect(withGate[0].policy.precondition?.timeoutSeconds).toBeGreaterThan(0);
  });
});

describe("agent assignment", () => {
  it("cycles so two CLIs still make a multi-provider example", () => {
    expect(assignAgents(["a", "b"], 0)).toBe("a");
    expect(assignAgents(["a", "b"], 1)).toBe("b");
    expect(assignAgents(["a", "b"], 2)).toBe("a");
  });

  it("leaves the slot empty rather than inventing an agent", () => {
    // The editor then asks the user to pick, which is honest; a made-up id
    // would fail at run time with a confusing "not installed".
    expect(assignAgents([], 0)).toBe("");
    const built = buildExample(EXAMPLES[0], { ...opts, installedAgents: [] });
    expect(built.steps.every((s) => s.agent === "")).toBe(true);
  });
});
