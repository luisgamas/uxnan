import { describe, expect, it, vi } from "vitest";
import type { Thread, Turn, TurnList, TurnStatus } from "$shared/models/thread";
import {
  ThreadActivity,
  localSeenStore,
  parseSeenMarks,
  type SeenMarks,
  type SeenStore,
} from "./activity.svelte";
import { sidebarChats } from "./chatList";

const note = (method: string, params: Record<string, unknown>) => ({ method, params });

function thread(id: string, updatedAt: number, extra: Partial<Thread> = {}): Thread {
  return { id, projectId: "p", title: id, status: "active", turnCount: 0, createdAt: 0, updatedAt, ...extra };
}

/** A turn as `turn/list` serves it. */
function turn(threadId: string, status: TurnStatus, completedAt: number, seq = 1): Turn {
  return {
    id: `${threadId}-turn-${seq}`,
    threadId,
    seq,
    status,
    messages: [
      { id: `${threadId}-u${seq}`, turnId: `${threadId}-turn-${seq}`, role: "user", content: "hi", createdAt: completedAt - 5 },
      { id: `${threadId}-a${seq}`, turnId: `${threadId}-turn-${seq}`, role: "assistant", content: "hello", createdAt: completedAt - 4 },
    ],
    createdAt: completedAt - 5,
    completedAt,
  };
}

/** Storage that outlives one `ThreadActivity`, like the window's between runs. */
function memoryStore(initial: SeenMarks | null = null) {
  let saved = initial ? structuredClone(initial) : null;
  const store: SeenStore = {
    load: () => (saved ? structuredClone(saved) : null),
    save: (marks) => {
      saved = structuredClone(marks);
    },
  };
  return { store, marks: () => saved };
}

/** A bridge answering `turn/list { limit: 1, fromEnd: true }` with its last page. */
function bridgeTurns(pages: Record<string, TurnList>) {
  const lastTurn = vi.fn(async (threadId: string) => {
    const page = pages[threadId] ?? { turns: [] };
    return page.turns[page.turns.length - 1];
  });
  return lastTurn;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ThreadActivity", () => {
  it("follows a turn: working, waiting on an approval, working, then done until seen", () => {
    const a = new ThreadActivity({ store: memoryStore().store });
    expect(a.of("t")).toBe("idle");
    a.apply(note("stream/turn/started", { threadId: "t", turnId: "x" }));
    expect(a.of("t")).toBe("working");
    a.apply(
      note("stream/content/block", {
        threadId: "t",
        turnId: "x",
        content: { type: "approval", approvalId: "ap" },
      }),
    );
    expect(a.of("t")).toBe("waiting");
    a.apply(note("stream/approval/resolved", { threadId: "t", approvalId: "ap", decision: "approve" }));
    expect(a.of("t")).toBe("working");
    a.apply(note("stream/turn/completed", { threadId: "t", turnId: "x" }));
    expect(a.of("t")).toBe("done");
    a.seen("t", 1);
    expect(a.of("t")).toBe("idle");
  });

  it("marks a failed turn blocked, a stopped one idle, and ignores ordinary blocks", () => {
    const a = new ThreadActivity({ store: memoryStore().store });
    a.apply(note("stream/turn/started", { threadId: "t", turnId: "x" }));
    a.apply(note("stream/content/block", { threadId: "t", content: { type: "command_execution" } }));
    expect(a.of("t")).toBe("working");
    a.apply(note("stream/turn/error", { threadId: "t", turnId: "x" }));
    expect(a.of("t")).toBe("blocked");
    a.apply(note("stream/turn/started", { threadId: "t", turnId: "y" }));
    a.apply(note("stream/turn/aborted", { threadId: "t", turnId: "y" }));
    expect(a.of("t")).toBe("idle");
  });

  it("adopts the running turns a fresh thread list carries, and forgets what it no longer lists", () => {
    const a = new ThreadActivity({ store: memoryStore().store });
    a.apply(note("stream/turn/started", { threadId: "old", turnId: "x" }));
    a.adoptList([thread("run", 1, { activeTurnId: "t1" }), thread("old", 2)]);
    expect(a.of("run")).toBe("working");
    expect(a.of("old")).toBe("idle");
    a.apply(note("stream/turn/completed", { threadId: "run", turnId: "t1" }));
    a.adoptList([]);
    expect(a.of("run")).toBe("idle");
  });
});

describe("ThreadActivity across restarts", () => {
  it("counts everything there is as seen the first time it runs", () => {
    const { store, marks } = memoryStore();
    const lastTurn = bridgeTurns({});
    const a = new ThreadActivity({ store, lastTurn });
    a.adoptList([thread("a", 100, { turnCount: 3 }), thread("b", 250, { turnCount: 1 }), thread("c", 40)]);
    expect([a.of("a"), a.of("b"), a.of("c")]).toEqual(["idle", "idle", "idle"]);
    expect(lastTurn).not.toHaveBeenCalled();
    expect(marks()).toEqual({ baseline: 250, threads: {} });
  });

  it("keeps a finished thread nobody looked at done after a restart, until it is seen", async () => {
    const { store, marks } = memoryStore();
    const first = new ThreadActivity({ store, lastTurn: bridgeTurns({}) });
    first.adoptList([thread("t", 100, { turnCount: 1 })]);
    // A turn runs and finishes while its tab is not in view…
    first.apply(note("stream/turn/started", { threadId: "t", turnId: "t-turn-2" }));
    first.apply(note("stream/turn/completed", { threadId: "t", turnId: "t-turn-2" }));
    expect(first.of("t")).toBe("done");

    // …and the app restarts (an update) before anyone opens it.
    const lastTurn = bridgeTurns({ t: { turns: [turn("t", "completed", 180, 2)], total: 2 } });
    const second = new ThreadActivity({ store, lastTurn });
    second.adoptList([thread("t", 180, { turnCount: 2 })]);
    await flush();
    expect(lastTurn).toHaveBeenCalledWith("t");
    expect(second.of("t")).toBe("done");
    expect(sidebarChats([thread("t", 180, { turnCount: 2 })], { open: new Set(), activityOf: (id) => second.of(id) }).map((x) => x.id)).toEqual(["t"]);

    // Opening it clears it and remembers that, by the bridge's clock.
    second.seen("t", 180);
    expect(second.of("t")).toBe("idle");
    expect(marks()?.threads.t).toBe(180);

    const third = new ThreadActivity({ store, lastTurn });
    third.adoptList([thread("t", 180, { turnCount: 2 })]);
    await flush();
    expect(third.of("t")).toBe("idle");
    expect(lastTurn).toHaveBeenCalledTimes(1);
  });

  it("restores a thread whose last turn failed as blocked", async () => {
    const { store } = memoryStore({ baseline: 100, threads: {} });
    const a = new ThreadActivity({
      store,
      lastTurn: bridgeTurns({ f: { turns: [turn("f", "error", 150)], total: 1 } }),
    });
    a.adoptList([thread("f", 150, { turnCount: 1 })]);
    await flush();
    expect(a.of("f")).toBe("blocked");
  });

  it("does not flag a thread that only changed name since it was seen, and stops asking", async () => {
    const { store, marks } = memoryStore({ baseline: 100, threads: { r: 200 } });
    const lastTurn = bridgeTurns({ r: { turns: [turn("r", "completed", 190)], total: 1 } });
    const a = new ThreadActivity({ store, lastTurn });
    a.adoptList([thread("r", 260, { turnCount: 1 })]);
    await flush();
    expect(a.of("r")).toBe("idle");
    expect(marks()?.threads.r).toBe(260);
    a.adoptList([thread("r", 260, { turnCount: 1 })]);
    await flush();
    expect(lastTurn).toHaveBeenCalledTimes(1);
  });

  it("lets what happens live win over a late answer about the last turn", async () => {
    const { store } = memoryStore({ baseline: 100, threads: {} });
    let answer!: (t: Turn) => void;
    const a = new ThreadActivity({
      store,
      lastTurn: () => new Promise<Turn>((resolve) => (answer = resolve)),
    });
    a.adoptList([thread("l", 150, { turnCount: 1 })]);
    a.apply(note("stream/turn/started", { threadId: "l", turnId: "next" }));
    answer(turn("l", "completed", 150));
    await flush();
    expect(a.of("l")).toBe("working");
  });

  it("drops the marks of threads that are gone, and of those the baseline covers", () => {
    const { store, marks } = memoryStore({ baseline: 100, threads: { kept: 300, gone: 400, old: 90 } });
    const a = new ThreadActivity({ store, lastTurn: bridgeTurns({}) });
    a.adoptList([thread("kept", 300, { turnCount: 1 }), thread("old", 90, { turnCount: 1 })]);
    expect(marks()).toEqual({ baseline: 100, threads: { kept: 300 } });
  });

  it("marks a moved thread done when there is no way to ask for its last turn", () => {
    const { store } = memoryStore({ baseline: 100, threads: {} });
    const a = new ThreadActivity({ store });
    a.adoptList([thread("n", 150, { turnCount: 1 }), thread("empty", 150), thread("arch", 150, { turnCount: 1, status: "archived" })]);
    expect([a.of("n"), a.of("empty"), a.of("arch")]).toEqual(["done", "idle", "idle"]);
  });

  it("keeps the marks in the window's storage, and ignores anything that is not marks", () => {
    localStorage.removeItem("uxnan.chat.seen");
    expect(localSeenStore.load()).toBeNull();
    localSeenStore.save({ baseline: 5, threads: { t: 9 } });
    expect(localSeenStore.load()).toEqual({ baseline: 5, threads: { t: 9 } });
    localStorage.setItem("uxnan.chat.seen", "{not json");
    expect(localSeenStore.load()).toBeNull();
    localStorage.removeItem("uxnan.chat.seen");
    expect(parseSeenMarks({ baseline: "x" })).toBeNull();
    expect(parseSeenMarks({ baseline: 1, threads: { a: 2, b: "no" } })).toEqual({ baseline: 1, threads: { a: 2 } });
  });
});

describe("sidebarChats", () => {
  it("lists what is open in a tab or needs attention, never the idle history", () => {
    const threads = [
      thread("a", 50),
      thread("b", 40),
      thread("open", 10),
      thread("busy", 5),
      thread("gone", 60, { status: "archived" }),
    ];
    const shown = sidebarChats(threads, {
      open: new Set(["open", "gone"]),
      activityOf: (id) => (id === "busy" ? "working" : "idle"),
    });
    expect(shown.map((t) => t.id)).toEqual(["open", "busy"]);
  });
});

describe("the bridge's live set", () => {
  it("marks working and waiting threads, and clears one that ended while away", () => {
    const a = new ThreadActivity({ store: memoryStore().store });
    // The replica still says it runs (unchanged since the cursor): the live
    // set is what tells otherwise.
    a.adoptList([thread("t1", 10, { activeTurnId: "tu1" }), thread("t2", 10)]);
    expect(a.of("t1")).toBe("working");

    a.adoptLive([{ threadId: "t2", activeTurnId: "tu2", awaitingInput: ["ap1"] }]);
    expect(a.of("t1")).toBe("idle");
    expect(a.of("t2")).toBe("waiting");

    // The approval was answered elsewhere; the turn goes on.
    a.adoptLive([{ threadId: "t2", activeTurnId: "tu2" }]);
    expect(a.of("t2")).toBe("working");

    a.adoptLive([]);
    expect(a.of("t2")).toBe("idle");
  });
});
