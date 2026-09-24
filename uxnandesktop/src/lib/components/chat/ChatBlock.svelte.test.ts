/**
 * The interactive parts of a chat turn, over the real IPC seam: an approval or
 * question answered here reaches the bridge, and one answered elsewhere (the
 * phone) settles the card here too.
 */

import { describe, expect, it } from "vitest";
import { mount, until } from "../../../test/render";
import { Conversation } from "$lib/bridge/conversation.svelte";
import { bridge } from "$lib/bridge/client.svelte";
import { chat } from "$lib/bridge/chat.svelte";
import ChatBlock from "./ChatBlock.svelte";
import ChatBridgeGate from "./ChatBridgeGate.svelte";

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

  it("renders nothing for a block type it does not know", () => {
    const { screen } = mount(ChatBlock, {
      props: { block: { type: "from-the-future" }, threadId: "t1", conversation: conversation() },
    });
    expect(screen.container.textContent?.trim()).toBe("");
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
});
