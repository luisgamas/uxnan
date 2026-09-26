/**
 * A chat tab before its first message: sending it must not leave the message
 * behind as the tab's draft — the conversation that replaces this view reads
 * that draft into its composer (the "text stays after the first message" bug).
 */

import { describe, expect, it } from "vitest";
import { mountWithProviders, until } from "../../../test/render";
import { chat } from "$lib/bridge/chat.svelte";
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
});
