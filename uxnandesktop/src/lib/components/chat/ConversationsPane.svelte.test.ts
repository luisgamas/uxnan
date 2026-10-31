/**
 * The Conversations tab's second view (architecture/02a §5.8.19): the agents'
 * own sessions in the folder, next to the conversations — the one place they
 * are listed, which the new-chat screen links to.
 */

import { describe, expect, it } from "vitest";
import { mountWithProviders, until } from "../../../test/render";
import { chat } from "$lib/bridge/chat.svelte";
import { bridge } from "$lib/bridge/client.svelte";
import type { ConversationsTab } from "$lib/state/terminals.svelte";
import type { Thread } from "$shared/models/thread";
import ConversationsPane from "./ConversationsPane.svelte";

function conversationsTab(view?: "chats" | "sessions"): ConversationsTab {
  return {
    id: "tab-c",
    kind: "conversations",
    title: "Conversations",
    cwd: "/repo",
    ...(view ? { view } : {}),
  } as ConversationsTab;
}

const commands = {
  bridge_call: (args: Record<string, unknown>) => {
    if (args.method === "agent/sessions") {
      return {
        sessions: [
          { agentId: "codex", sessionId: "c-1", cwd: "/repo", title: "Fix the login", updatedAgoMs: 60_000 },
          { agentId: "opencode", sessionId: "o-1", cwd: "/repo", updatedAgoMs: 90_000 },
        ],
        unlisted: [],
      };
    }
    if (args.method === "project/resolve") return { id: "p", name: "repo" };
    return {};
  },
};

describe("ConversationsPane sessions view", () => {
  it("opens on the agent sessions when asked to, with their count on the switch", async () => {
    bridge.status = { state: "connected" } as typeof bridge.status;
    chat.agentSessions.clear();
    chat.threads.clear();
    chat.threads.set("th-1", {
      id: "th-1",
      projectId: "p",
      title: "A conversation",
      status: "active",
      turnCount: 1,
      createdAt: 1,
      updatedAt: 1,
      cwd: "/repo",
    } as Thread);
    const { screen, user } = mountWithProviders(ConversationsPane, {
      props: { tab: conversationsTab("sessions"), active: true },
      commands,
    });
    await until(() => screen.queryByText("Fix the login") !== null);
    expect(screen.getByText("Untitled opencode session")).toBeTruthy();
    // The conversation is not in this view.
    expect(screen.queryByText("A conversation")).toBeNull();
    expect(screen.getByRole("radio", { name: /Agent sessions/ }).textContent).toContain("2");

    // Back to the conversations: the sessions leave, the scope control returns.
    await user.click(screen.getByRole("radio", { name: /^Conversations/ }));
    await until(() => screen.queryAllByText("A conversation").length > 0);
    expect(screen.queryByText("Fix the login")).toBeNull();
    chat.threads.clear();
    chat.agentSessions.clear();
    bridge.status = { state: "off" } as typeof bridge.status;
  });

  it("opens on the conversations by default", async () => {
    bridge.status = { state: "connected" } as typeof bridge.status;
    chat.agentSessions.clear();
    chat.threads.clear();
    const { screen } = mountWithProviders(ConversationsPane, {
      props: { tab: conversationsTab(), active: true },
      commands,
    });
    await until(() => chat.agentSessionsOf("/repo") !== undefined);
    expect(screen.queryByText("Fix the login")).toBeNull();
    expect(screen.getByText("This project")).toBeTruthy();
    chat.agentSessions.clear();
    bridge.status = { state: "off" } as typeof bridge.status;
  });
});
