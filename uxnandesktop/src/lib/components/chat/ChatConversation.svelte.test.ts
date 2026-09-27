/**
 * A started chat keeps what the user wrote: a message that did not reach the
 * bridge comes back after a restart with Retry, and a message pulled back to
 * be edited sets the composer's own text aside instead of merging into it.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mountWithProviders, until } from "../../../test/render";
import { chat } from "$lib/bridge/chat.svelte";
import { writeOutbox } from "$lib/bridge/outbox";
import type { Turn } from "$shared/models/thread";
import type { ChatTab } from "$lib/state/terminals.svelte";
import ChatConversation from "./ChatConversation.svelte";

const THREAD = "th-outbox";

function chatTab(extra: Partial<ChatTab> = {}): ChatTab {
  return { id: "tab-1", kind: "chat", title: "Chat", cwd: "/repo", threadId: THREAD, ...extra } as ChatTab;
}

function queuedTurn(id: string, text: string): Turn {
  return {
    id,
    threadId: THREAD,
    status: "queued",
    createdAt: 1,
    messages: [{ id: `${id}-u`, turnId: id, role: "user", content: text, createdAt: 1 }],
  };
}

function mount(tab: ChatTab, calls: { method: string; params: unknown }[] = []) {
  chat.threads.set(THREAD, {
    id: THREAD,
    projectId: "p",
    title: "Fix the build",
    status: "active",
    turnCount: 0,
    createdAt: 0,
    updatedAt: 0,
    cwd: "/repo",
    agentId: "codex",
  } as never);
  return mountWithProviders(ChatConversation, {
    props: { tab, threadId: THREAD, cwd: "/repo", active: true },
    commands: {
      bridge_call: (args: Record<string, unknown>) => {
        calls.push({ method: String(args.method), params: args.params });
        return {};
      },
    },
  });
}

afterEach(() => {
  chat.holds.clear();
  chat.release(THREAD);
  chat.threads.delete(THREAD);
  chat.agents = [];
});

describe("ChatConversation", () => {
  // While a terminal holds the conversation's session it is the writer: the
  // composer waits and the banner offers to take the session back here.
  it("says the session is open in a terminal, waits, and takes it back when asked", async () => {
    const calls: { method: string; params: unknown }[] = [];
    const { screen, user } = mount(chatTab(), calls);
    chat.threads.set(THREAD, { ...chat.threads.get(THREAD)!, agentSessionId: "c-1" });
    chat.holds.set("codex:c-1", {
      agentId: "codex",
      sessionId: "c-1",
      holder: { kind: "terminal", name: "Studio" },
      heldAgoMs: 0,
      busy: false,
    });
    await until(() => screen.queryByText(/open in a terminal on Studio/) !== null);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Continue here" }));
    await until(() => calls.some((c) => c.method === "agent/requestHandoff"));
    expect(calls.find((c) => c.method === "agent/requestHandoff")?.params).toMatchObject({
      agentId: "codex",
      sessionId: "c-1",
    });
    chat.holds.delete("codex:c-1");
    await until(() => screen.queryByText(/open in a terminal on Studio/) === null);
    expect(box.disabled).toBe(false);
  });

  it("brings back a message the bridge never confirmed, and sends it again", async () => {
    writeOutbox(THREAD, [
      { clientTurnId: "c1", text: "run the tests", request: { text: "run the tests" } },
    ]);
    const calls: { method: string; params: unknown }[] = [];
    const { screen, user } = mount(chatTab(), calls);

    expect(screen.getByText("run the tests")).toBeTruthy();
    expect(screen.getByText("Not sent")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await until(() => calls.some((c) => c.method === "turn/send"));
    expect(calls.find((c) => c.method === "turn/send")?.params).toEqual({
      threadId: THREAD,
      text: "run the tests",
      clientTurnId: "c1",
    });
    expect(screen.queryByText("Not sent")).toBeNull();
  });

  it("shows the images of a message, as the bridge keeps them", async () => {
    const { screen } = mountWithProviders(ChatConversation, {
      props: { tab: chatTab(), threadId: THREAD, cwd: "/repo", active: true },
      commands: {
        bridge_call: (args: Record<string, unknown>) =>
          args.method === "turn/attachment" ? { mimeType: "image/png", base64Data: "AAAA" } : {},
      },
    });
    chat.conversation(THREAD).adoptPage({
      turns: [
        {
          id: "t-img",
          threadId: THREAD,
          status: "completed",
          createdAt: 1,
          messages: [
            {
              id: "t-img-u",
              turnId: "t-img",
              role: "user",
              content: "What overlaps here?",
              attachments: [{ id: "t-img-0.png", mimeType: "image/png", bytes: 3 }],
              createdAt: 1,
            },
          ],
        },
      ],
      total: 1,
    });
    const thumb = await screen.findByRole("button", { name: "Open image 1" });
    await until(() => thumb.querySelector("img")?.getAttribute("src") === "data:image/png;base64,AAAA");
    expect(screen.getByText("What overlaps here?")).toBeTruthy();
  });

  it("sends a queued message now when nothing is running", async () => {
    const calls: { method: string; params: unknown }[] = [];
    const { screen, user } = mount(chatTab(), calls);
    chat.conversation(THREAD).adoptPage({
      turns: [queuedTurn("q1", "first"), queuedTurn("q2", "second")],
      total: 2,
      queuedTurnIds: ["q1", "q2"],
      queuePaused: true,
    });
    const sendNow = await screen.findAllByRole("button", { name: "Send now" });
    await user.click(sendNow[1]!);
    await until(() => calls.some((c) => c.method === "queue/sendNow"));
    expect(calls.find((c) => c.method === "queue/sendNow")?.params).toEqual({
      threadId: THREAD,
      turnId: "q2",
    });
  });

  it("offers no send now while an agent that takes no input mid-turn works", async () => {
    chat.agents = [{ agentId: "codex", displayName: "Codex", available: true, capabilities: {} }] as never;
    const { screen } = mount(chatTab());
    chat.conversation(THREAD).adoptPage({
      turns: [
        { id: "run", threadId: THREAD, status: "streaming", createdAt: 1, messages: [] },
        queuedTurn("q1", "later"),
      ],
      total: 2,
      activeTurnId: "run",
      queuedTurnIds: ["q1"],
    });
    await screen.findByText("later");
    expect(screen.queryByRole("button", { name: "Send now" })).toBeNull();

    chat.agents = [
      { agentId: "codex", displayName: "Codex", available: true, capabilities: { steering: true } },
    ] as never;
    expect(await screen.findByRole("button", { name: "Send now" })).toBeTruthy();
  });

  it("sets the composer's text aside when a queued message comes back to be edited", async () => {
    const tab = chatTab({ draft: "half a thought" });
    const { screen, user } = mount(tab);
    chat.conversation(THREAD).adoptPage({
      turns: [queuedTurn("q1", "then update the docs")],
      total: 1,
      queuedTurnIds: ["q1"],
    });
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;

    await user.click(await screen.findByRole("button", { name: "Edit (take it off the queue)" }));
    await until(() => box.value === "then update the docs");
    expect(tab.rescued).toEqual(["half a thought"]);
    expect(screen.getByText("1 saved draft")).toBeTruthy();

    // Putting the saved draft back swaps it with what the composer holds now.
    await user.click(screen.getByText("half a thought"));
    await until(() => box.value === "half a thought");
    expect(tab.rescued).toEqual(["then update the docs"]);

    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(tab.rescued).toBeUndefined();
    expect(screen.queryByText("1 saved draft")).toBeNull();
  });
});
