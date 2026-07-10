import { describe, expect, it } from "vitest";
import {
  applyManualOrder,
  attentionClass,
  compareBy,
  mostUrgentStatus,
  partitionPinned,
  reorderByDrag,
  sortItems,
  type SortMeta,
} from "./sidebar-sort";

/** Build a SortMeta with sensible defaults, overriding only what a test needs. */
function meta(over: Partial<SortMeta> = {}): SortMeta {
  return {
    name: "",
    lastActive: 0,
    status: null,
    unread: false,
    activityAt: 0,
    ...over,
  };
}

describe("attentionClass", () => {
  it("puts blocked/waiting agents in the urgent class (1)", () => {
    expect(attentionClass("blocked", false)).toBe(1);
    expect(attentionClass("waiting", false)).toBe(1);
  });

  it("classes a done-but-unreviewed result as 2, acknowledged as 4", () => {
    expect(attentionClass("done", true)).toBe(2);
    expect(attentionClass("done", false)).toBe(4);
  });

  it("classes working agents as 3", () => {
    expect(attentionClass("working", false)).toBe(3);
  });

  it("classes idle/no-agent as 4, but still bubbles an unread result to 2", () => {
    expect(attentionClass("idle", false)).toBe(4);
    expect(attentionClass(null, false)).toBe(4);
    expect(attentionClass(null, true)).toBe(2);
  });
});

describe("mostUrgentStatus", () => {
  it("returns null when there are no agents", () => {
    expect(mostUrgentStatus([])).toBeNull();
    expect(mostUrgentStatus([null, null])).toBeNull();
  });

  it("prefers blocked/waiting over done over working over idle", () => {
    expect(mostUrgentStatus(["working", "done", "blocked"])).toBe("blocked");
    expect(mostUrgentStatus(["idle", "working", "done"])).toBe("done");
    expect(mostUrgentStatus(["idle", "working"])).toBe("working");
    expect(mostUrgentStatus(["idle", null])).toBe("idle");
  });
});

describe("compareBy", () => {
  it("orders names case-insensitively and numerically (asc/desc)", () => {
    const a = meta({ name: "alpha" });
    const b = meta({ name: "Beta" });
    expect(compareBy("name-asc", a, b)).toBeLessThan(0);
    expect(compareBy("name-desc", a, b)).toBeGreaterThan(0);
    // Natural numeric order: "item2" before "item10".
    expect(
      compareBy("name-asc", meta({ name: "item2" }), meta({ name: "item10" })),
    ).toBeLessThan(0);
  });

  it("orders recent by most-recently-active first", () => {
    const older = meta({ name: "a", lastActive: 100 });
    const newer = meta({ name: "b", lastActive: 200 });
    expect(compareBy("recent", newer, older)).toBeLessThan(0);
  });

  it("treats manual as a no-op comparison", () => {
    expect(compareBy("manual", meta({ name: "a" }), meta({ name: "z" }))).toBe(0);
  });

  it("orders attention by urgency class before recency", () => {
    const needsYou = meta({ status: "blocked", activityAt: 1 });
    const working = meta({ status: "working", activityAt: 999 });
    // The blocked agent wins even though the working one has a fresher signal.
    expect(compareBy("attention", needsYou, working)).toBeLessThan(0);
  });
});

describe("sortItems", () => {
  const items = [
    meta({ name: "charlie", lastActive: 10 }),
    meta({ name: "alpha", lastActive: 30 }),
    meta({ name: "bravo", lastActive: 20 }),
  ];

  it("sorts by name ascending", () => {
    const out = sortItems(items, "name-asc", (m) => m);
    expect(out.map((m) => m.name)).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("sorts by recent (most-recent first)", () => {
    const out = sortItems(items, "recent", (m) => m);
    expect(out.map((m) => m.name)).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("returns a stable copy unchanged for manual", () => {
    const out = sortItems(items, "manual", (m) => m);
    expect(out).not.toBe(items); // a copy, safe to mutate
    expect(out.map((m) => m.name)).toEqual(["charlie", "alpha", "bravo"]);
  });

  it("is stable: equal keys keep their original relative order", () => {
    const tied = [
      meta({ name: "same", lastActive: 5 }),
      meta({ name: "same", lastActive: 5 }),
    ];
    tied[0].activityAt = 111; // tag them so we can tell them apart
    tied[1].activityAt = 222;
    const out = sortItems(tied, "name-asc", (m) => m);
    expect(out.map((m) => m.activityAt)).toEqual([111, 222]);
  });

  it("surfaces the agent that needs you first under attention", () => {
    const list = [
      meta({ name: "idle-one", status: "idle" }),
      meta({ name: "working-one", status: "working" }),
      meta({ name: "blocked-one", status: "blocked" }),
      meta({ name: "done-unread", status: "done", unread: true }),
    ];
    const out = sortItems(list, "attention", (m) => m).map((m) => m.name);
    expect(out).toEqual(["blocked-one", "done-unread", "working-one", "idle-one"]);
  });
});

describe("applyManualOrder", () => {
  const key = (s: string) => s;

  it("applies the requested order", () => {
    const out = applyManualOrder(["a", "b", "c"], ["c", "a", "b"], key);
    expect(out).toEqual(["c", "a", "b"]);
  });

  it("keeps unlisted items after the listed ones, in original order", () => {
    // Only c and a are ordered; b and d self-heal to the end, order preserved.
    const out = applyManualOrder(["a", "b", "c", "d"], ["c", "a"], key);
    expect(out).toEqual(["c", "a", "b", "d"]);
  });

  it("ignores unknown keys in the order list", () => {
    const out = applyManualOrder(["a", "b"], ["zzz", "b", "a"], key);
    expect(out).toEqual(["b", "a"]);
  });

  it("is a no-op for an empty order", () => {
    const out = applyManualOrder(["a", "b"], [], key);
    expect(out).toEqual(["a", "b"]);
  });
});

describe("reorderByDrag", () => {
  it("moves an item downward to the dropped slot", () => {
    // Drag "a" (index 0) to the slot after "c" (insertion index 3).
    expect(reorderByDrag(["a", "b", "c", "d"], "a", 3)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item upward to the dropped slot", () => {
    // Drag "d" (index 3) to the slot before "b" (insertion index 1).
    expect(reorderByDrag(["a", "b", "c", "d"], "d", 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("is a no-op when dropped on its own position", () => {
    expect(reorderByDrag(["a", "b", "c"], "b", 1)).toEqual(["a", "b", "c"]);
    expect(reorderByDrag(["a", "b", "c"], "b", 2)).toEqual(["a", "b", "c"]);
  });

  it("moves an item to the very end", () => {
    expect(reorderByDrag(["a", "b", "c"], "a", 3)).toEqual(["b", "c", "a"]);
  });

  it("ignores an unknown key", () => {
    expect(reorderByDrag(["a", "b"], "zzz", 0)).toEqual(["a", "b"]);
  });
});

describe("partitionPinned", () => {
  it("floats pinned items to the front, keeping order within each group", () => {
    const out = partitionPinned(["a", "b", "c", "d"], (x) => x === "b" || x === "d");
    expect(out).toEqual(["b", "d", "a", "c"]);
  });

  it("is a no-op when nothing is pinned", () => {
    expect(partitionPinned(["a", "b", "c"], () => false)).toEqual(["a", "b", "c"]);
  });

  it("keeps the incoming order when everything is pinned", () => {
    expect(partitionPinned(["a", "b", "c"], () => true)).toEqual(["a", "b", "c"]);
  });
});
