import { describe, expect, it } from "vitest";
import { removalDefaults, type RemovalInputs } from "./worktree-removal";

/** A finished, clean, unattended worktree on a branch. */
function base(over: Partial<RemovalInputs> = {}): RemovalInputs {
  return {
    completion: "done",
    dirty: 0,
    ahead: 0,
    liveAgents: 0,
    hasBranch: true,
    ...over,
  };
}

describe("removalDefaults", () => {
  it("pre-ticks the branch delete once the work landed", () => {
    const d = removalDefaults(base());
    expect(d.deleteLocal).toBe(true);
    expect(d.verdict).toBe("done");
    expect(d.warnings).toEqual([]);
  });

  it("does not pre-tick an abandoned branch", () => {
    // Nobody merged it — `git branch -d` would refuse, and forcing is not a default.
    const d = removalDefaults(base({ completion: "abandoned" }));
    expect(d.deleteLocal).toBe(false);
    expect(d.verdict).toBe("abandoned");
  });

  it("does not pre-tick anything for work still in play", () => {
    for (const completion of ["active", "inert"] as const) {
      const d = removalDefaults(base({ completion }));
      expect(d.deleteLocal).toBe(false);
      expect(d.verdict).toBeNull();
    }
  });

  it("does not pre-tick a detached worktree — there is no branch", () => {
    expect(removalDefaults(base({ hasBranch: false })).deleteLocal).toBe(false);
  });

  it("keeps the branch pre-ticked despite uncommitted files", () => {
    // They are not commits, so they say nothing about whether the branch landed.
    // The warning still fires; the two concerns are independent.
    const d = removalDefaults(base({ dirty: 5 }));
    expect(d.deleteLocal).toBe(true);
    expect(d.warnings).toContain("uncommitted");
  });

  it("warns without ever blocking", () => {
    const d = removalDefaults(base({ dirty: 2, ahead: 3, liveAgents: 1 }));
    expect(d.warnings).toEqual(["uncommitted", "unpushed", "live-agents"]);
    // Removal stays available: wiping a dead end is sometimes the point.
    expect(d).not.toHaveProperty("blocked");
  });

  it("orders the unrecoverable warning first", () => {
    expect(removalDefaults(base({ dirty: 1, ahead: 1 })).warnings[0]).toBe("uncommitted");
  });

  it("never returns a forced default", () => {
    // Pins the intent: adding a force default must be a deliberate change.
    expect(Object.keys(removalDefaults(base({ completion: "abandoned", dirty: 9 })))).not.toContain(
      "forceLocal",
    );
  });
});
