import { describe, expect, it } from "vitest";
import type { Thread } from "$shared/models/thread";
import { ThreadActivity } from "./activity.svelte";
import { sidebarChats } from "./chatList";

const note = (method: string, params: Record<string, unknown>) => ({ method, params });

function thread(id: string, updatedAt: number, extra: Partial<Thread> = {}): Thread {
  return { id, projectId: "p", title: id, status: "active", turnCount: 0, createdAt: 0, updatedAt, ...extra };
}

describe("ThreadActivity", () => {
  it("follows a turn: working, waiting on an approval, working, then done until seen", () => {
    const a = new ThreadActivity();
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
    a.seen("t");
    expect(a.of("t")).toBe("idle");
  });

  it("marks a failed turn blocked, a stopped one idle, and ignores ordinary blocks", () => {
    const a = new ThreadActivity();
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
    const a = new ThreadActivity();
    a.apply(note("stream/turn/started", { threadId: "old", turnId: "x" }));
    a.adoptList([thread("run", 1, { activeTurnId: "t1" }), thread("old", 2)]);
    expect(a.of("run")).toBe("working");
    expect(a.of("old")).toBe("idle");
    a.apply(note("stream/turn/completed", { threadId: "run", turnId: "t1" }));
    a.adoptList([]);
    expect(a.of("run")).toBe("idle");
  });
});

describe("sidebarChats", () => {
  it("always lists open and active conversations, then fills with the most recent", () => {
    const threads = [
      thread("a", 50),
      thread("b", 40),
      thread("c", 30),
      thread("d", 20),
      thread("open", 10),
      thread("busy", 5),
      thread("gone", 60, { status: "archived" }),
    ];
    const shown = sidebarChats(threads, {
      open: new Set(["open"]),
      activityOf: (id) => (id === "busy" ? "working" : "idle"),
      limit: 3,
    });
    expect(shown.map((t) => t.id)).toEqual(["a", "open", "busy"]);
  });
});
