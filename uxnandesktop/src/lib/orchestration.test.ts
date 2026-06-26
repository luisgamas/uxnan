import { describe, expect, it } from "vitest";
import {
  agentType,
  agentTypes,
  drainAvailable,
  enqueueAll,
  pendingCount,
  resolveTargets,
  type OrchestratorAgent,
  type Queues,
} from "./orchestration";

function agent(tabId: string, type: string, busy = false): OrchestratorAgent {
  return { tabId, workspace: "/w", name: type, type, status: "idle", busy };
}

describe("agentType", () => {
  it("normalizes a command to a lowercase type key", () => {
    expect(agentType("Claude")).toBe("claude");
    expect(agentType("  CODEX  ")).toBe("codex");
    expect(agentType(undefined)).toBe("");
  });
});

describe("agentTypes", () => {
  it("returns distinct types in first-seen order", () => {
    const agents = [agent("a", "claude"), agent("b", "codex"), agent("c", "claude")];
    expect(agentTypes(agents)).toEqual(["claude", "codex"]);
  });
});

describe("resolveTargets", () => {
  const agents = [agent("a", "claude"), agent("b", "claude"), agent("c", "codex")];

  it("addresses all agents", () => {
    expect(resolveTargets(agents, { kind: "all" })).toEqual(["a", "b", "c"]);
  });

  it("fans out by type", () => {
    expect(resolveTargets(agents, { kind: "type", type: "claude" })).toEqual(["a", "b"]);
    expect(resolveTargets(agents, { kind: "type", type: "aider" })).toEqual([]);
  });

  it("filters an explicit selection to live, deduped ids", () => {
    expect(resolveTargets(agents, { kind: "tabs", tabIds: ["c", "gone", "c", "a"] })).toEqual([
      "c",
      "a",
    ]);
  });
});

describe("enqueueAll + pendingCount", () => {
  it("fans a message out into per-agent queues with monotonic ids", () => {
    let id = 0;
    const q = enqueueAll({}, ["a", "b"], "hello", () => ++id);
    expect(q.a).toEqual([{ id: 1, message: "hello" }]);
    expect(q.b).toEqual([{ id: 2, message: "hello" }]);
    expect(pendingCount(q)).toBe(2);
  });

  it("appends to an existing queue", () => {
    let id = 10;
    let q: Queues = enqueueAll({}, ["a"], "first", () => ++id);
    q = enqueueAll(q, ["a"], "second", () => ++id);
    expect(q.a.map((m) => m.message)).toEqual(["first", "second"]);
  });
});

describe("drainAvailable (backpressure)", () => {
  it("dispatches only the head of each available agent's queue", () => {
    const queues: Queues = {
      a: [
        { id: 1, message: "a1" },
        { id: 2, message: "a2" },
      ],
      b: [{ id: 3, message: "b1" }],
    };
    const { dispatch, queues: next } = drainAvailable(queues, () => true);
    // One message per agent — the next stays queued (no flooding).
    expect(dispatch).toEqual([
      { tabId: "a", queued: { id: 1, message: "a1" } },
      { tabId: "b", queued: { id: 3, message: "b1" } },
    ]);
    expect(next.a).toEqual([{ id: 2, message: "a2" }]);
    expect(next.b).toEqual([]);
  });

  it("holds messages for unavailable (busy) agents", () => {
    const queues: Queues = { a: [{ id: 1, message: "a1" }], b: [{ id: 2, message: "b1" }] };
    const { dispatch, queues: next } = drainAvailable(queues, (id) => id === "a");
    expect(dispatch).toEqual([{ tabId: "a", queued: { id: 1, message: "a1" } }]);
    // b was busy: its message is untouched.
    expect(next.b).toEqual([{ id: 2, message: "b1" }]);
  });

  it("is a no-op when every agent is busy", () => {
    const queues: Queues = { a: [{ id: 1, message: "a1" }] };
    const { dispatch, queues: next } = drainAvailable(queues, () => false);
    expect(dispatch).toEqual([]);
    expect(next).toEqual(queues);
  });
});
