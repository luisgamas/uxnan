/**
 * The chat actions' dialogs: deleting asks first — saying it is for every
 * device — and only then reaches the bridge.
 */

import { describe, expect, it } from "vitest";
import { mountWithProviders, until } from "../../../test/render";
import { chatActionUi } from "$lib/bridge/chatActions.svelte";
import ChatActionDialogs from "./ChatActionDialogs.svelte";

const thread = {
  id: "th-del",
  projectId: "p",
  title: "Old experiment",
  status: "idle" as const,
  turnCount: 1,
  createdAt: 0,
  updatedAt: 0,
  cwd: "/repo",
};

describe("ChatActionDialogs", () => {
  it("confirms a delete for every device, then deletes the thread on the bridge", async () => {
    const { screen, backend, user } = mountWithProviders(ChatActionDialogs, {
      commands: { bridge_call: () => ({}) },
    });
    chatActionUi.run("delete", thread, () => undefined);
    await until(() => screen.queryByText("Delete this chat?") !== null);
    expect(screen.getByText(/for every device/)).toBeTruthy();
    expect(backend.called("bridge_call")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await until(() => backend.called("bridge_call"));
    expect(backend.lastCallTo("bridge_call")?.args).toEqual({
      method: "thread/delete",
      params: { threadId: "th-del" },
    });
    await until(() => chatActionUi.deleting === null);
  });
});
