/**
 * The interactive parts of a chat turn, over the real IPC seam: an approval or
 * question answered here reaches the bridge, and one answered elsewhere (the
 * phone) settles the card here too.
 */

import { describe, expect, it } from "vitest";
import { mount, mountWithProviders, until } from "../../../test/render";

/** Whether a node sits inside a collapsed section (Bits UI may keep a closed
 *  section's content mounted, marked closed and hidden). */
function folded(node: HTMLElement | null): boolean {
  return !node || node.closest('[data-slot="collapsible-content"][data-state="closed"], [hidden]') !== null;
}
import { Conversation } from "$lib/bridge/conversation.svelte";
import { bridge } from "$lib/bridge/client.svelte";
import { chat } from "$lib/bridge/chat.svelte";
import type { Turn } from "$shared/models/thread";
import ChatBlock from "./ChatBlock.svelte";
import ChatBridgeGate from "./ChatBridgeGate.svelte";
import ChatTurnView from "./ChatTurnView.svelte";
import ChatWorkGroup from "./ChatWorkGroup.svelte";

function conversation(): Conversation {
  return new Conversation("t1", async () => ({}) as never);
}

const approval = {
  type: "approval",
  approvalId: "ap-1",
  action: "Allow Bash: rm -rf build",
  risk: "high",
  detail: "rm -rf build",
};

describe("ChatBlock", () => {
  it("answers an approval through the bridge and settles the card", async () => {
    // In the app the card's conversation IS the store's; answering settles it.
    const c = chat.conversation("t-approve");
    const { screen, backend, user } = mount(ChatBlock, {
      props: { block: approval, threadId: "t-approve", conversation: c },
      commands: { bridge_call: () => ({ turnId: "" }) },
    });
    expect(screen.getByText("Allow Bash: rm -rf build")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Allow" }));
    await until(() => backend.called("bridge_call"));
    expect(backend.lastCallTo("bridge_call")?.args).toEqual({
      method: "turn/send",
      params: { threadId: "t-approve", approvalResponse: { approvalId: "ap-1", decision: "approve" } },
    });
    await until(() => screen.queryByRole("button", { name: "Allow" }) === null);
  });

  it("settles when the phone answered first", async () => {
    const c = conversation();
    const { screen } = mount(ChatBlock, {
      props: { block: approval, threadId: "t1", conversation: c },
    });
    c.apply({
      method: "stream/approval/resolved",
      params: { threadId: "t1", approvalId: "ap-1", decision: "reject" },
    });
    await until(() => screen.queryByText("Denied") !== null);
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
  });

  it("answers a question with the chosen option", async () => {
    const c = conversation();
    const { screen, backend, user } = mount(ChatBlock, {
      props: {
        block: {
          type: "question",
          questionId: "q-1",
          questions: [{ question: "Which database?", options: [{ label: "SQLite" }, { label: "Postgres" }] }],
        },
        threadId: "t1",
        conversation: c,
      },
      commands: { bridge_call: () => ({ turnId: "" }) },
    });
    await user.click(screen.getByRole("button", { name: "Postgres" }));
    await user.click(screen.getByRole("button", { name: "Answer" }));
    await until(() => backend.called("bridge_call"));
    expect(backend.lastCallTo("bridge_call")?.args).toEqual({
      method: "turn/send",
      params: { threadId: "t1", questionResponse: { questionId: "q-1", answers: [["Postgres"]] } },
    });
  });

  it("never offers to answer an approval whose turn already ended", () => {
    const { screen } = mount(ChatBlock, {
      props: { block: approval, threadId: "t1", conversation: conversation(), live: false },
    });
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    expect(screen.getByText("No longer waiting for an answer")).toBeTruthy();
  });

  it("records a request in the timeline as one line, then how it ended", async () => {
    const c = conversation();
    const { screen } = mount(ChatBlock, {
      props: { block: approval, threadId: "t1", conversation: c, compact: true },
    });
    expect(screen.getByText("Allow Bash: rm -rf build")).toBeTruthy();
    expect(screen.getByText("Waiting for you")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    c.apply({
      method: "stream/approval/resolved",
      params: { threadId: "t1", approvalId: "ap-1", decision: "approve" },
    });
    await until(() => screen.queryByText("Waiting for you") === null);
  });

  it("renders nothing for a block type it does not know", () => {
    const { screen } = mount(ChatBlock, {
      props: { block: { type: "from-the-future" }, threadId: "t1", conversation: conversation() },
    });
    expect(screen.container.textContent?.trim()).toBe("");
  });
});

describe("ChatWorkGroup", () => {
  const blocks = [
    { type: "command_execution", command: "npm test", exitCode: 1, output: "1 failing" },
    { type: "command_execution", command: "ls", exitCode: 0 },
    { type: "diff", filename: "src/a.ts", additions: 3, deletions: 1 },
  ];

  it("sums up a settled run of steps and opens back to them", async () => {
    const { screen, user } = mount(ChatWorkGroup, { props: { blocks, live: false } });
    expect(screen.getByText("Ran 2 commands · 1 edit")).toBeTruthy();
    expect(screen.getByText("1 failed")).toBeTruthy();
    expect(folded(screen.queryByText("npm test"))).toBe(true);
    await user.click(screen.getByText("Ran 2 commands · 1 edit"));
    await until(() => !folded(screen.queryByText("npm test")));
    expect(screen.getByText("exit 1")).toBeTruthy();
  });

  it("stays open while the turn runs", () => {
    const { screen } = mount(ChatWorkGroup, { props: { blocks, live: true } });
    expect(screen.getByText("npm test")).toBeTruthy();
    expect(screen.getByText("src/a.ts")).toBeTruthy();
  });
});

describe("ChatTurnView", () => {
  const settled: Turn = {
    id: "turn-1",
    threadId: "t1",
    status: "completed",
    createdAt: 1_000,
    completedAt: 64_000,
    messages: [
      { id: "u", turnId: "turn-1", role: "user", content: "Fix the build", createdAt: 1_000 },
      {
        id: "a",
        turnId: "turn-1",
        role: "assistant",
        content: "",
        createdAt: 64_000,
        segments: [
          { type: "text", text: "Looking at the failure." },
          { type: "command_execution", command: "npm run build", exitCode: 0 },
          { type: "diff", filename: "src/app.ts", additions: 2, deletions: 2 },
          { type: "text", text: "The build passes now." },
        ],
      },
    ],
  };

  it("folds a settled turn's work behind its duration and keeps the answer and its files", async () => {
    const { screen, user } = mount(ChatTurnView, {
      props: { turn: settled, threadId: "t1", cwd: "/repo", conversation: conversation() },
    });
    expect(screen.getByText("Fix the build")).toBeTruthy();
    expect(screen.getByText("The build passes now.")).toBeTruthy();
    expect(screen.getByText("1 file changed")).toBeTruthy();
    expect(folded(screen.queryByText("Looking at the failure."))).toBe(true);
    await user.click(screen.getByText("Worked for 1m 3s"));
    await until(() => !folded(screen.queryByText("Looking at the failure.")));
  });
});

describe("ChatBridgeGate", () => {
  it("offers to connect while the bridge connection is off", async () => {
    bridge.applyStatus({ state: "off" });
    const { screen, backend, user } = mount(ChatBridgeGate, {
      commands: { update_settings: () => ({}) },
    });
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await until(() => backend.called("update_settings"));
    const settings = backend.lastCallTo("update_settings")?.args.settings as {
      bridge?: { mode: string };
    };
    expect(settings.bridge?.mode).toBe("managed");
  });

  it("names why the bridge is unreachable and offers a retry", () => {
    bridge.applyStatus({ state: "unavailable", reason: "notInstalled", detail: "uxnan-bridge is not on PATH" });
    const { screen } = mount(ChatBridgeGate);
    expect(screen.getByText("The bridge is not installed (uxnan-bridge is not on PATH).")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    bridge.applyStatus({ state: "off" });
  });

  it("installs a missing bridge in place, then connects to it", async () => {
    bridge.applyStatus({ state: "off" });
    const { screen, backend, user } = mountWithProviders(ChatBridgeGate, {
      commands: {
        bridge_install_probe: () => ({
          installed: false,
          version: null,
          npm: true,
          nodeVersion: "v22.1.0",
          command: "npm install -g uxnan-bridge@latest",
        }),
        bridge_install: () => ({
          ok: true,
          version: "0.0.30",
          permissionDenied: false,
          tail: [],
          restarted: false,
        }),
        update_settings: () => ({}),
      },
    });
    await until(() => screen.queryByRole("button", { name: "Install" }) !== null);
    expect(screen.getByText("Install the Uxnan bridge to chat")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Install" }));
    await until(() => backend.called("update_settings"));
    expect(backend.called("bridge_install")).toBe(true);
    const settings = backend.lastCallTo("update_settings")?.args.settings as {
      bridge?: { mode: string };
    };
    expect(settings.bridge?.mode).toBe("managed");
  });

  const installedOld = {
    bridge_install_probe: () => ({
      installed: true,
      version: null,
      npm: true,
      nodeVersion: "v22.1.0",
      command: "npm install -g uxnan-bridge@latest",
    }),
  };

  it("offers to update a running bridge too old to talk to the desktop", async () => {
    bridge.applyStatus({
      state: "unavailable",
      reason: "outdated",
      detail: "a bridge is running (pid 42) but predates the desktop channel",
    });
    const { screen } = mountWithProviders(ChatBridgeGate, { commands: installedOld });
    // The install probe is shared app state: wait for this test's answer.
    await until(
      () => screen.queryByText("The running bridge is too old to talk to Uxnan Desktop: update it.") !== null,
    );
    expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
    expect(screen.getByText("npm install -g uxnan-bridge@latest")).toBeTruthy();
    bridge.applyStatus({ state: "off" });
  });

  it("restarts a bridge that runs without the channel of the version installed", async () => {
    bridge.applyStatus({ state: "unavailable", reason: "channelOff", detail: null });
    const { screen, backend, user } = mountWithProviders(ChatBridgeGate, {
      commands: { ...installedOld, bridge_restart: () => null },
    });
    await user.click(screen.getByRole("button", { name: "Restart the bridge" }));
    await until(() => backend.called("bridge_restart"));
    bridge.applyStatus({ state: "off" });
  });
});
