import { describe, expect, it } from "vitest";
import { planBatchClose, type BatchCandidate } from "./worktree-batch-close";
import type { RemovalInputs } from "./worktree-removal";

function inputs(over: Partial<RemovalInputs> = {}): RemovalInputs {
  return {
    completion: "done",
    dirty: 0,
    ahead: 0,
    liveAgents: 0,
    hasBranch: true,
    ...over,
  };
}

function candidate(name: string, over: Partial<RemovalInputs> = {}): BatchCandidate<string> {
  return { item: name, inputs: inputs(over) };
}

describe("planBatchClose", () => {
  it("closes every finished, clean workspace", () => {
    const plan = planBatchClose([candidate("a"), candidate("b")]);
    expect(plan.close.map((e) => e.item)).toEqual(["a", "b"]);
    expect(plan.skipped).toEqual([]);
  });

  it("deletes the branch of landed work and keeps an abandoned one", () => {
    const plan = planBatchClose([
      candidate("landed"),
      candidate("dropped", { completion: "abandoned" }),
    ]);
    expect(plan.close).toEqual([
      { item: "landed", deleteLocal: true },
      { item: "dropped", deleteLocal: false },
    ]);
  });

  it("SKIPS uncommitted work instead of overriding it", () => {
    // The single dialog lets you override this — you are looking at one worktree.
    // A batch is a count, so it never gets that benefit of the doubt.
    const plan = planBatchClose([candidate("clean"), candidate("messy", { dirty: 3 })]);
    expect(plan.close.map((e) => e.item)).toEqual(["clean"]);
    expect(plan.skipped).toEqual([{ item: "messy", reason: "uncommitted" }]);
  });

  it("skips unpushed commits", () => {
    const plan = planBatchClose([candidate("ahead", { ahead: 2 })]);
    expect(plan.close).toEqual([]);
    expect(plan.skipped).toEqual([{ item: "ahead", reason: "unpushed" }]);
  });

  it("skips a workspace with a live agent", () => {
    const plan = planBatchClose([candidate("busy", { liveAgents: 1 })]);
    expect(plan.skipped).toEqual([{ item: "busy", reason: "live-agents" }]);
  });

  it("skips one that stopped being finished since the lane was built", () => {
    const plan = planBatchClose([candidate("moved", { completion: "active" })]);
    expect(plan.skipped).toEqual([{ item: "moved", reason: "not-finished" }]);
  });

  it("reports the unrecoverable reason first when several apply", () => {
    const plan = planBatchClose([candidate("bad", { dirty: 1, ahead: 1, liveAgents: 1 })]);
    expect(plan.skipped[0].reason).toBe("uncommitted");
  });

  it("never silently shrinks the list", () => {
    const all = [
      candidate("a"),
      candidate("b", { dirty: 1 }),
      candidate("c", { completion: "abandoned" }),
      candidate("d", { liveAgents: 1 }),
    ];
    const plan = planBatchClose(all);
    expect(plan.close.length + plan.skipped.length).toBe(all.length);
  });

  it("handles an empty lane", () => {
    expect(planBatchClose([])).toEqual({ close: [], skipped: [] });
  });
});
