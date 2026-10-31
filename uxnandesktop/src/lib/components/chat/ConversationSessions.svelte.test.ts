/**
 * The agents' own sessions in a folder, as the Conversations tab lists them
 * (architecture/02a §5.8.19): the one place they are listed. Picking one
 * continues it as a chat; one open in a terminal asks it to let go first.
 */

import { describe, expect, it, vi } from "vitest";
import { mountWithProviders, until } from "../../../test/render";
import { chat } from "$lib/bridge/chat.svelte";
import { bridge } from "$lib/bridge/client.svelte";
import ConversationSessions from "./ConversationSessions.svelte";

const held = {
  agentId: "codex",
  sessionId: "c-2",
  holder: { kind: "terminal", name: "Studio" },
  heldAgoMs: 0,
  busy: false,
};
const started = {
  id: "th-c1",
  projectId: "p",
  title: "Held one",
  status: "active",
  turnCount: 0,
  createdAt: 0,
  updatedAt: 0,
  cwd: "/repo",
};

function bridgeAnswers(args: Record<string, unknown>) {
  if (args.method === "agent/sessions") {
    return {
      sessions: [
        { agentId: "codex", sessionId: "c-1", cwd: "/repo", title: "Fix the login", updatedAgoMs: 60_000 },
        { agentId: "codex", sessionId: "c-2", cwd: "/repo", title: "Held one", updatedAgoMs: 1_000, hold: held },
        { agentId: "opencode", sessionId: "o-1", cwd: "/repo", updatedAgoMs: 120_000 },
        { agentId: "opencode", sessionId: "o-2", cwd: "/repo", updatedAgoMs: 130_000, titlePending: true },
        { agentId: "codex", sessionId: "c-3", cwd: "/repo", title: "In a chat", updatedAgoMs: 1, threadId: "th-9" },
      ],
      unlisted: ["antigravity-cli"],
    };
  }
  if (args.method === "agent/requestHandoff") return { outcome: "released" };
  if (args.method === "thread/start") return started;
  return {};
}

describe("ConversationSessions", () => {
  it("lists the sessions no conversation continues, untitled ones included, and says who cannot list", async () => {
    bridge.status = { state: "connected" } as typeof bridge.status;
    chat.agentSessions.clear();
    const { screen } = mountWithProviders(ConversationSessions, {
      props: { chat, cwd: "/repo", query: "", folder: "repo", onPicked: () => undefined },
      commands: { bridge_call: bridgeAnswers },
    });
    await chat.refreshAgentSessions("/repo");
    await until(() => screen.queryByText("Fix the login") !== null);
    // One a conversation already continues is not offered again.
    expect(screen.queryByText("In a chat")).toBeNull();
    expect(screen.getByText("Untitled opencode session")).toBeTruthy();
    // One the bridge is naming says so rather than reading as untitled.
    expect(screen.getByText("Naming…")).toBeTruthy();
    expect(screen.getByText("In a terminal")).toBeTruthy();
    expect(screen.getByText(/can't list its sessions/)).toBeTruthy();
    chat.agentSessions.clear();
    bridge.status = { state: "off" } as typeof bridge.status;
  });

  it("narrows by agent and by title", async () => {
    bridge.status = { state: "connected" } as typeof bridge.status;
    chat.agentSessions.clear();
    const { screen } = mountWithProviders(ConversationSessions, {
      props: { chat, cwd: "/repo", query: "login", folder: "repo", onPicked: () => undefined },
      commands: { bridge_call: bridgeAnswers },
    });
    await chat.refreshAgentSessions("/repo");
    await until(() => screen.queryByText("Fix the login") !== null);
    expect(screen.queryByText("Held one")).toBeNull();
    chat.agentSessions.clear();
    bridge.status = { state: "off" } as typeof bridge.status;
  });

  it("asks the holding terminal to let go, then continues the session as a chat", async () => {
    bridge.status = { state: "connected" } as typeof bridge.status;
    chat.agentSessions.clear();
    const onPicked = vi.fn();
    const { screen, user, backend } = mountWithProviders(ConversationSessions, {
      props: { chat, cwd: "/repo", query: "", folder: "repo", onPicked },
      commands: { bridge_call: bridgeAnswers },
    });
    await chat.refreshAgentSessions("/repo");
    await until(() => screen.queryByText("Held one") !== null);
    await user.click(screen.getByText("Held one"));
    await until(() => onPicked.mock.calls.length > 0);
    const methods = backend.callsTo("bridge_call").map((c) => c.args.method);
    expect(methods.indexOf("agent/requestHandoff")).toBeLessThan(methods.indexOf("thread/start"));
    const start = backend.callsTo("bridge_call").find((c) => c.args.method === "thread/start");
    expect(start?.args.params).toMatchObject({ agentId: "codex", agentSessionId: "c-2", title: "Held one" });
    expect(onPicked.mock.calls[0]?.[0]).toMatchObject({ id: "th-c1" });
    chat.agentSessions.clear();
    bridge.status = { state: "off" } as typeof bridge.status;
  });
});
