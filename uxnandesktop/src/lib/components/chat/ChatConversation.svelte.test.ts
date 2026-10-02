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

  it("offers send now on every queued message, and says it stops a working agent", async () => {
    const { screen } = mount(chatTab());
    const conversation = chat.conversation(THREAD);
    conversation.adoptPage({
      turns: [
        { id: "run", threadId: THREAD, status: "streaming", createdAt: 1, messages: [] },
        queuedTurn("q1", "later"),
        queuedTurn("q2", "and this"),
      ],
      total: 3,
      activeTurnId: "run",
      queuedTurnIds: ["q1", "q2"],
    });
    await screen.findByText("later");
    // The first one too: a message sent by mistake can always be taken back or forced.
    expect(screen.getAllByRole("button", { name: "Stop the agent and send this now" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Edit (take it off the queue)" })).toHaveLength(2);

    // Stopped with the messages still waiting: sending one now just runs it.
    conversation.adoptPage({
      turns: [
        { id: "run", threadId: THREAD, status: "aborted", createdAt: 1, messages: [] },
        queuedTurn("q1", "later"),
      ],
      total: 2,
      queuedTurnIds: ["q1"],
      queuePaused: true,
      queuePausedReason: "turnAborted",
    });
    expect(await screen.findByRole("button", { name: "Send now" })).toBeTruthy();
  });

  it("marks the queued message the agent is taking, and no longer offers to take it back", async () => {
    const { screen } = mount(chatTab());
    chat.conversation(THREAD).adoptPage({
      turns: [
        { id: "run", threadId: THREAD, status: "streaming", createdAt: 1, messages: [] },
        queuedTurn("q1", "check the docs too"),
        queuedTurn("q2", "and the changelog"),
      ],
      total: 3,
      activeTurnId: "run",
      queuedTurnIds: ["q1", "q2"],
      queueDeliveringTurnId: "q1",
    });
    expect(
      await screen.findByText("Reaching the agent"),
    ).toBeTruthy();
    // Only the one still waiting can be edited or cancelled.
    expect(screen.getAllByRole("button", { name: "Edit (take it off the queue)" })).toHaveLength(1);
    expect(screen.getByText("2 in the queue")).toBeTruthy();
    expect(screen.queryByText("Next in the queue")).toBeNull();
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

  it("shows the queue in place, below everything, each message with its position", async () => {
    const { screen } = mount(chatTab());
    chat.conversation(THREAD).adoptPage({
      turns: [queuedTurn("q1", "first"), queuedTurn("q2", "second")],
      total: 2,
      queuedTurnIds: ["q1", "q2"],
    });
    expect(await screen.findByText("Next in the queue")).toBeTruthy();
    expect(screen.getByText("2 in the queue")).toBeTruthy();
    // The dock no longer lists them a second time.
    expect(screen.queryByText("2 messages queued")).toBeNull();
  });

  it("takes a message withdrawn for editing out of the timeline", async () => {
    const { screen, user } = mount(chatTab());
    const conversation = chat.conversation(THREAD);
    conversation.adoptPage({
      turns: [queuedTurn("q1", "then update the docs")],
      total: 1,
      queuedTurnIds: ["q1"],
    });
    await user.click(await screen.findByRole("button", { name: "Edit (take it off the queue)" }));
    // The bridge answers with the cancel and the emptied queue.
    conversation.apply({ method: "stream/turn/cancelled", params: { threadId: THREAD, turnId: "q1" } });
    conversation.apply({
      method: "stream/queue/updated",
      params: { threadId: THREAD, queuedTurnIds: [], paused: false },
    });
    await until(() => screen.queryByText("Next in the queue") === null);
    expect(screen.queryByText("Cancelled before it ran")).toBeNull();
  });

  it("shows a turn whose run went on in a later message whole, and marks that message", async () => {
    const { screen } = mount(chatTab());
    chat.conversation(THREAD).adoptPage({
      turns: [
        {
          id: "a",
          threadId: THREAD,
          status: "completed",
          createdAt: 1,
          completedAt: 5,
          continuedIn: "b",
          messages: [
            { id: "a-u", turnId: "a", role: "user", content: "fix the tests", createdAt: 1 },
            {
              id: "a-a",
              turnId: "a",
              role: "assistant",
              content: "",
              createdAt: 2,
              segments: [
                { type: "text", text: "Looking at the failures first." },
                { type: "command_execution", command: "npm test", status: "completed", exitCode: 1 },
              ],
            },
          ],
        } as Turn,
        {
          id: "b",
          threadId: THREAD,
          status: "completed",
          createdAt: 5,
          completedAt: 9,
          messages: [
            { id: "b-u", turnId: "b", role: "user", content: "only the unit ones", createdAt: 5 },
            { id: "b-a", turnId: "b", role: "assistant", content: "Done, unit tests pass.", createdAt: 6 },
          ],
        } as Turn,
      ],
      total: 2,
    });
    // Its prose is not folded away as finished work: it is the answer so far.
    expect(await screen.findByText("Looking at the failures first.")).toBeTruthy();
    expect(screen.getByText("Continues below, with your next message")).toBeTruthy();
    expect(screen.getByText("Reached the agent while it was working")).toBeTruthy();
  });
});
