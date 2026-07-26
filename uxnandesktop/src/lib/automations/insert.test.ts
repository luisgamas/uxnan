import { describe, expect, it } from "vitest";
import { insertToken } from "./insert";
import { newStep, type Step } from "./types";

function step(prompt: string, dependsOn: string[] = [], id = "s3"): Step {
  return { ...newStep(id, "claude"), prompt, dependsOn };
}

describe("inserting a value into a prompt", () => {
  it("lands at the caret, not at the end", () => {
    // A value almost always belongs mid-sentence; appending would force the
    // user to cut and paste it into place every time.
    const r = insertToken(step("Summarize  please"), "{{X}}", 10, 10);
    expect(r.step.prompt).toBe("Summarize {{X}} please");
  });

  it("replaces the selected text", () => {
    const r = insertToken(step("Summarize THIS please"), "{{X}}", 10, 14);
    expect(r.step.prompt).toBe("Summarize {{X}} please");
  });

  it("leaves the caret after what was inserted", () => {
    const r = insertToken(step("ab"), "{{X}}", 1, 1);
    expect(r.step.prompt).toBe("a{{X}}b");
    expect(r.caret).toBe(1 + "{{X}}".length);
  });

  it("copes with a backwards selection", () => {
    // Dragging right-to-left gives start > end.
    const r = insertToken(step("Summarize THIS please"), "{{X}}", 14, 10);
    expect(r.step.prompt).toBe("Summarize {{X}} please");
  });

  it("clamps a stale caret instead of losing the tail", () => {
    // A re-rendered field can report a position past the end; slicing on it
    // unguarded would silently drop everything after it.
    const r = insertToken(step("abc"), "!", 99, 99);
    expect(r.step.prompt).toBe("abc!");
    const negative = insertToken(step("abc"), "!", -5, -5);
    expect(negative.step.prompt).toBe("!abc");
  });

  it("starts waiting for the step it references", () => {
    const r = insertToken(step("", []), "{{steps.s1.output}}", 0, 0, "s1");
    expect(r.step.dependsOn).toEqual(["s1"]);
  });

  it("does not add a dependency twice", () => {
    const r = insertToken(step("", ["s1"]), "{{steps.s1.output}}", 0, 0, "s1");
    expect(r.step.dependsOn).toEqual(["s1"]);
  });

  it("takes no dependency for a previous-run value", () => {
    // That run already finished, so there is nothing to wait for.
    const r = insertToken(step("", []), "{{prev.s1.output}}", 0, 0);
    expect(r.step.dependsOn).toEqual([]);
  });

  it("refuses to make a step wait for itself", () => {
    // A step depending on its own output could never start.
    const r = insertToken(step("", [], "s2"), "{{steps.s2.output}}", 0, 0, "s2");
    expect(r.step.dependsOn).toEqual([]);
  });

  it("leaves the rest of the step untouched", () => {
    const original = step("hi", ["s1"]);
    const r = insertToken(original, "!", 2, 2);
    expect(r.step.id).toBe(original.id);
    expect(r.step.agent).toBe(original.agent);
    expect(original.prompt).toBe("hi");
  });
});
