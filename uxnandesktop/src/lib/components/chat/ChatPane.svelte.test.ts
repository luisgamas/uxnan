/**
 * A chat tab talks to the bridge of the machine its thread lives on.
 *
 * The pane provides that machine's replica to everything below it, so a tab
 * whose `target` is a host starts its thread on that host's own bridge — never
 * on this machine's, which has never heard of the folder.
 */

import { describe, expect, it } from "vitest";
import { mountWithProviders, until } from "../../../test/render";
import { chatFor } from "$lib/bridge/chat.svelte";
import { bridges } from "$lib/bridge/client.svelte";
import type { ChatTab } from "$lib/state/terminals.svelte";
import ChatPane from "./ChatPane.svelte";

const CONNECTED = { state: "connected", bridgeVersion: "0.0.46", instanceId: "i", managed: false } as const;

describe("ChatPane on a host", () => {
  it("starts the conversation on that host's own bridge", async () => {
    const tab = {
      id: "tab-h",
      kind: "chat",
      title: "Chat",
      cwd: "/srv/app",
      target: "ssh:h1",
      draft: "hello there",
    } as ChatTab;
    chatFor("ssh:h1");
    // The host's own agents, as its bridge lists them.
    const agents = [
      {
        agentId: "codex",
        displayName: "Codex",
        available: true,
        capabilities: { streaming: true, approvals: false, forking: false, images: false },
      },
    ];
    const { screen, user, backend } = mountWithProviders(ChatPane, {
      props: { tab, active: true },
      commands: {
        bridge_call: (args: Record<string, unknown>) =>
          args.method === "agent/list"
            ? { agents }
            : args.method === "thread/start"
            ? { id: "th-h", projectId: "p", title: "t", status: "active", turnCount: 0, createdAt: 0, updatedAt: 0, cwd: "/srv/app" }
            : {},
      },
    });
    bridges.for("ssh:h1").applyStatus(CONNECTED);

    await until(() => chatFor("ssh:h1").agents.length > 0, { label: "the host's agents" });
    const box = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    await user.click(box);
    await user.keyboard("{Enter}");
    await until(() => backend.callsTo("bridge_call").some((c) => c.args.method === "thread/start"), {
      label: "the thread start",
    });
    const start = backend.callsTo("bridge_call").find((c) => c.args.method === "thread/start");
    expect(start?.args.target).toBe("ssh:h1");
    // Nothing of this chat went to this machine's bridge.
    expect(
      backend.callsTo("bridge_call").some((c) => c.args.method === "thread/start" && c.args.target === undefined),
    ).toBe(false);
  });
});
