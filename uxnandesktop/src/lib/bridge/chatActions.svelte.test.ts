import { describe, expect, it } from "vitest";
import { chatActionsFor } from "./chatActions.svelte";

describe("chatActionsFor", () => {
  it("offers rename and archive on a live chat, restore on an archived one, delete on both", () => {
    expect(chatActionsFor({ status: "active" })).toEqual(["open", "rename", "archive", "delete"]);
    expect(chatActionsFor({ status: "idle" })).toEqual(["open", "rename", "archive", "delete"]);
    expect(chatActionsFor({ status: "archived" })).toEqual(["open", "unarchive", "delete"]);
  });
});
