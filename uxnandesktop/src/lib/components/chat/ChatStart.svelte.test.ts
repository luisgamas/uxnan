/**
 * A chat tab before its first message: sending it must not leave the message
 * behind as the tab's draft — the conversation that replaces this view reads
 * that draft into its composer (the "text stays after the first message" bug).
 */

import { describe, expect, it, vi } from "vitest";
import { mountWithProviders, until } from "../../../test/render";
import { chat } from "$lib/bridge/chat.svelte";
import { bridge } from "$lib/bridge/client.svelte";
import type { Thread } from "$shared/models/thread";
import { terminals, type ChatTab } from "$lib/state/terminals.svelte";
import ChatStart from "./ChatStart.svelte";
import { serialize } from "$lib/components/ui/input-group/chip-editor";

/** What the composer's editor holds, as the string it sends (a chip is a marker). */
const valueOf = (box: HTMLElement) => serialize(box).text;

function chatTab(): ChatTab {
  return { id: "tab-1", kind: "chat", title: "Chat", cwd: "/repo", draft: "fix it" } as ChatTab;
}

function withAgent(): void {
  chat.agents = [
    {
      agentId: "codex",
      displayName: "Codex",
      available: true,
      capabilities: {
        streaming: true,
        approvals: false,
        forking: false,
        images: false,
      },
    },
  ];
}

const started = {
  id: "th-new",
  projectId: "p",
  title: "New thread",
  status: "active",
  turnCount: 0,
  createdAt: 0,
  updatedAt: 0,
  cwd: "/repo",
};

describe("ChatStart", () => {
  it("drops the tab's draft when the first message goes out", async () => {
    withAgent();
    const tab = chatTab();
    const { screen, user, backend } = mountWithProviders(ChatStart, {
      props: { tab, active: true },
      commands: {
        bridge_call: (args: Record<string, unknown>) => (args.method === "thread/start" ? started : {}),
      },
    });
    const box = screen.getByRole("textbox");
    expect(valueOf(box)).toBe("fix it");
    await user.click(box);
    await user.keyboard("{Enter}");
    await until(() => backend.called("bridge_call"));
    expect(tab.draft).toBeUndefined();
  });

  it("gives the text back when the conversation could not start", async () => {
    withAgent();
    const tab = chatTab();
    const { screen, user } = mountWithProviders(ChatStart, {
      props: { tab, active: true },
      commands: {
        bridge_call: () => {
          throw { message: "no bridge", code: "BRIDGE_ERROR" };
        },
      },
    });
    const box = screen.getByRole("textbox");
    await user.click(box);
    await user.keyboard("{Enter}");
    await until(() => tab.draft === "fix it");
    await until(() => valueOf(box) === "fix it");
  });

  // The screen is composer-first: at most the three newest conversations of the
  // folder, whatever the history, and "See all" for the rest — nothing expands
  // in place.
  it("shows three recent conversations at most, below the composer, with the full count", async () => {
    withAgent();
    bridge.status = { state: "connected" } as typeof bridge.status;
    chat.threadsLoaded = true;
    // The conversations earlier tests started are not part of this folder's history.
    chat.threads.clear();
    for (let i = 1; i <= 7; i++) {
      chat.threads.set(`th-${i}`, { ...started, id: `th-${i}`, title: `Chat ${i}`, updatedAt: i } as Thread);
    }
    const { screen } = mountWithProviders(ChatStart, {
      props: { tab: chatTab(), active: true },
      commands: { bridge_call: () => ({ sessions: [], unlisted: [] }) },
    });
    // The newest three, and the count of the rest behind "See all".
    for (const shown of ["Chat 7", "Chat 6", "Chat 5"]) expect(screen.getByText(shown)).toBeTruthy();
    for (const hidden of ["Chat 4", "Chat 1"]) expect(screen.queryByText(hidden)).toBeNull();
    expect(screen.getByText("See all conversations (7)")).toBeTruthy();
    expect(screen.queryByText(/Show all|Show fewer/)).toBeNull();
    // The composer comes first: the history never sits above it.
    const box = screen.getByRole("textbox");
    const recent = screen.getByText("Recent here");
    expect(box.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    chat.threads.clear();
    chat.threadsLoaded = false;
    bridge.status = { state: "off" } as typeof bridge.status;
  });

  it("keeps the composer at a fixed anchor, with its own reserved box for the history", () => {
    withAgent();
    const { screen } = mountWithProviders(ChatStart, {
      props: { tab: chatTab(), active: true },
    });
    const grid = screen.getByRole("textbox").closest(".grid");
    // A share of the pane above the hero, the hero itself, then a box that
    // cannot shrink below the history: what is below never moves what is above.
    expect(grid?.className).toContain("grid-rows-[minmax(1rem,24%)_auto_minmax(12.5rem,1fr)]");
  });

  // The agents' own sessions here no conversation continues yet are not listed:
  // one line says how many, and opens the Conversations tab on them.
  it("says how many agent sessions sit outside Uxnan and links to the Conversations tab", async () => {
    withAgent();
    bridge.status = { state: "connected" } as typeof bridge.status;
    chat.threadsLoaded = true;
    chat.agentSessions.clear();
    const open = vi.spyOn(terminals, "openConversations").mockReturnValue("conv-tab");
    const sessions = [1, 2, 3, 4].map((n) => ({
      agentId: "codex",
      sessionId: `c-${n}`,
      cwd: "/repo",
      title: `Session ${n}`,
      updatedAgoMs: n * 1000,
    }));
    const { screen, user } = mountWithProviders(ChatStart, {
      props: { tab: chatTab(), active: true },
      commands: {
        bridge_call: (args: Record<string, unknown>) =>
          args.method === "agent/sessions"
            ? {
                // One a conversation continues is not outside them.
                sessions: [...sessions, { ...sessions[0], sessionId: "c-9", threadId: "th-9" }],
                unlisted: [],
              }
            : {},
      },
    });
    const link = await screen.findByText("4 agent sessions in this folder outside Uxnan");
    // None of them is listed on this screen.
    expect(screen.queryByText("Session 1")).toBeNull();
    await user.click(link);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", view: "sessions" }));
    open.mockRestore();
    chat.agentSessions.clear();
    chat.threadsLoaded = false;
    bridge.status = { state: "off" } as typeof bridge.status;
  });

  it("shows no sessions line when there are none", async () => {
    withAgent();
    bridge.status = { state: "connected" } as typeof bridge.status;
    chat.threadsLoaded = true;
    chat.agentSessions.clear();
    const { screen, backend } = mountWithProviders(ChatStart, {
      props: { tab: chatTab(), active: true },
      commands: { bridge_call: () => ({ sessions: [], unlisted: [] }) },
    });
    await until(() => chat.agentSessionsOf("/repo") !== undefined);
    expect(backend.called("bridge_call")).toBe(true);
    expect(screen.queryByText(/agent sessions? in this folder/)).toBeNull();
    chat.agentSessions.clear();
    chat.threadsLoaded = false;
    bridge.status = { state: "off" } as typeof bridge.status;
  });
});
