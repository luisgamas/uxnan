/**
 * A chat tab before its first message: sending it must not leave the message
 * behind as the tab's draft — the conversation that replaces this view reads
 * that draft into its composer (the "text stays after the first message" bug).
 */

import { describe, expect, it } from "vitest";
import { mountWithProviders, until } from "../../../test/render";
import { chat } from "$lib/bridge/chat.svelte";
import { bridge } from "$lib/bridge/client.svelte";
import type { ChatTab } from "$lib/state/terminals.svelte";
import ChatStart from "./ChatStart.svelte";

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
        planMode: false,
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
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.value).toBe("fix it");
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
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.click(box);
    await user.keyboard("{Enter}");
    await until(() => tab.draft === "fix it");
    await until(() => box.value === "fix it");
  });

  // The agents' own sessions here that no conversation continues yet can be
  // picked up as this tab's chat; one open in a terminal asks it first.
  it("lists the folder's agent sessions and continues one as the chat", async () => {
    withAgent();
    bridge.status = { state: "connected" } as typeof bridge.status;
    const tab = chatTab();
    const held = {
      agentId: "codex",
      sessionId: "c-2",
      holder: { kind: "terminal", name: "Studio" },
      heldAgoMs: 0,
      busy: false,
    };
    const { screen, user, backend } = mountWithProviders(ChatStart, {
      props: { tab, active: true },
      commands: {
        bridge_call: (args: Record<string, unknown>) => {
          if (args.method === "agentSession/list") {
            return {
              sessions: [
                { agentId: "codex", sessionId: "c-1", cwd: "/repo", title: "Fix the login", updatedAgoMs: 60_000 },
                { agentId: "codex", sessionId: "c-2", cwd: "/repo", title: "Held one", updatedAgoMs: 1_000, hold: held },
                { agentId: "codex", sessionId: "c-3", cwd: "/repo", title: "In a chat", updatedAgoMs: 1, threadId: "th-9" },
              ],
              unlisted: ["antigravity-cli"],
            };
          }
          if (args.method === "agentSession/requestHandoff") return { outcome: "released" };
          if (args.method === "thread/start") return { ...started, id: "th-c1" };
          return {};
        },
      },
    });
    await until(() => screen.queryByText("Fix the login") !== null);
    // One a conversation already continues is not offered again.
    expect(screen.queryByText("In a chat")).toBeNull();
    expect(screen.getByText("In a terminal")).toBeTruthy();
    expect(screen.getByText(/can't list its sessions/)).toBeTruthy();

    await user.click(screen.getByText("Held one"));
    await until(() => backend.callsTo("bridge_call").some((c) => c.args.method === "thread/start"));
    const methods = backend.callsTo("bridge_call").map((c) => c.args.method);
    expect(methods.indexOf("agentSession/requestHandoff")).toBeLessThan(methods.indexOf("thread/start"));
    const start = backend.callsTo("bridge_call").find((c) => c.args.method === "thread/start");
    expect(start?.args.params).toMatchObject({ agentId: "codex", agentSessionId: "c-2", title: "Held one" });
    bridge.status = { state: "off" } as typeof bridge.status;
  });
});
