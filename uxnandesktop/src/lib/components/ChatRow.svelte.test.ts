/**
 * A bridge conversation in a worktree's agent view: named by the bridge, its
 * state from the one activity source every chat surface reads, and a click
 * that opens it.
 */

import { describe, expect, it } from "vitest";
import { mountWithProviders, until } from "../../test/render";
import { chat } from "$lib/bridge/chat.svelte";
import ChatRow from "./ChatRow.svelte";

const thread = {
  id: "row-t1",
  projectId: "p",
  title: "Fix the flaky test",
  status: "active" as const,
  turnCount: 2,
  createdAt: 0,
  updatedAt: Date.now(),
  agentId: "claude-code",
  model: "anthropic/claude-sonnet-5",
};

describe("ChatRow", () => {
  it("shows an idle chat as a chat on its model, and follows it while it works", async () => {
    const { screen } = mountWithProviders(ChatRow, { props: { thread, onopen: () => undefined } });
    expect(screen.getByText("Fix the flaky test")).toBeTruthy();
    expect(screen.getByText("Chat · claude-sonnet-5")).toBeTruthy();
    chat.activity.apply({ method: "stream/turn/started", params: { threadId: "row-t1", turnId: "x" } });
    await until(() => screen.queryByText("Working") !== null);
    chat.activity.apply({ method: "stream/turn/aborted", params: { threadId: "row-t1", turnId: "x" } });
    await until(() => screen.queryByText("Chat · claude-sonnet-5") !== null);
  });

  it("opens the conversation on click", async () => {
    let opened = 0;
    const { screen, user } = mountWithProviders(ChatRow, { props: { thread, onopen: () => (opened += 1) } });
    await user.click(screen.getByRole("button"));
    expect(opened).toBe(1);
  });
});
