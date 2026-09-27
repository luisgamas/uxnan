import { describe, expect, it } from "vitest";
import type { Turn } from "$shared/models/thread";
import { railAnchors } from "./railAnchors";

function turn(id: string, user: string, reply = "", attachments?: Turn["messages"][number]["attachments"]): Turn {
  return {
    id,
    threadId: "t",
    status: "completed",
    createdAt: 1,
    messages: [
      { id: `${id}-u`, turnId: id, role: "user", content: user, createdAt: 1, ...(attachments ? { attachments } : {}) },
      { id: `${id}-a`, turnId: id, role: "assistant", content: reply, createdAt: 2 },
    ],
  } as Turn;
}

describe("railAnchors", () => {
  it("marks every message the user sent, with the end of its reply", () => {
    expect(
      railAnchors(
        [turn("a", "fix the\n  dialog", "Looking.\n\nDone, it fits now."), turn("b", "thanks")],
        "Image",
      ),
    ).toEqual([
      { turnId: "a", preview: "fix the dialog", reply: "Done, it fits now." },
      { turnId: "b", preview: "thanks" },
    ]);
  });

  it("names a message of only attachments by its first one, and skips a turn with nothing sent", () => {
    const anchors = railAnchors(
      [
        turn("f", "", "", [{ id: "1", mimeType: "text/csv", bytes: 3, name: "people.csv" }]),
        turn("i", "", "", [{ id: "2", mimeType: "image/png", bytes: 3 }]),
        turn("x", ""),
      ],
      "Image",
    );
    expect(anchors.map((a) => a.preview)).toEqual(["people.csv", "Image"]);
  });

  it("keeps a long message to one short line", () => {
    const [anchor] = railAnchors([turn("l", "word ".repeat(60))], "Image");
    expect(anchor.preview.length).toBeLessThanOrEqual(90);
    expect(anchor.preview.endsWith("…")).toBe(true);
  });
});
