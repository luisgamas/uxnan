import { describe, expect, it } from "vitest";
import { chatActionsFor } from "./chatActions.svelte";

describe("chatActionsFor", () => {
  it("offers rename, fork, transfer and archive on a live chat, restore on an archived one", () => {
    const live = ["open", "rename", "fork", "transfer", "info", "archive", "delete"];
    expect(chatActionsFor({ status: "active" })).toEqual(live);
    expect(chatActionsFor({ status: "idle" })).toEqual(live);
    expect(chatActionsFor({ status: "archived" })).toEqual(["open", "info", "unarchive", "delete"]);
  });
});
