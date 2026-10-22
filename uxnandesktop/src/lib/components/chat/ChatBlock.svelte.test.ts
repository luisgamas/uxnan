/**
 * The interactive parts of a chat turn, over the real IPC seam: an approval or
 * question answered here reaches the bridge, and one answered elsewhere (the
 * phone) settles the card here too.
 */

import { describe, expect, it, vi } from "vitest";
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
import ChatActivity from "./ChatActivity.svelte";
import ChatBlock from "./ChatBlock.svelte";
import ChatRequest from "./ChatRequest.svelte";
import ChatBridgeGate from "./ChatBridgeGate.svelte";
import ChatTurnView from "./ChatTurnView.svelte";
import ChatWorkGroup from "./ChatWorkGroup.svelte";
import ChatView from "./ChatView.svelte";

class ImmediateIntersectionObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
  disconnect() {}
  unobserve() {}
  takeRecords() { return []; }
  root = null;
  rootMargin = "240px";
  thresholds = [0];
}

function conversation(): Conversation {
  return new Conversation("t1", async () => ({}) as never);
}

/** A conversation whose bridge answers [answers] per method (a value, or a
 *  function of the params), recording each call. */
function bridgeConversation(answers: Record<string, unknown>) {
  const calls: { method: string; params: unknown }[] = [];
  const c = new Conversation("t1", async (method: string, params?: unknown) => {
    calls.push({ method, params });
    const answer = answers[method];
    return (typeof answer === "function" ? (answer as (p: unknown) => unknown)(params) : answer) as never;
  });
  return { c, calls };
}

/** A settled run of [n] commands from index [from], as a page serves it. */
function run(from: number, n: number, extra: Record<string, unknown> = {}) {
  return {
    type: "work" as const,
    from,
    to: from + n - 1,
    commands: n,
    edits: 0,
    tools: 0,
    thoughts: 0,
    failed: 0,
    running: 0,
    files: [],
    last: { type: "command_execution" as const, index: from + n - 1, command: `step ${from + n - 1}` },
    ...extra,
  };
}

const preview = (index: number, extra: Record<string, unknown> = {}) => ({
  type: "command_execution",
  index,
  command: `step ${index}`,
  status: "completed",
  ...extra,
});

const approval = {
  type: "approval",
  approvalId: "ap-1",
  action: "Allow Bash: rm -rf build",
  risk: "high",
  detail: "rm -rf build",
};

describe("ChatBlock", () => {
  it("shows a labelled fallback for unknown content blocks", () => {
    const { screen } = mount(ChatBlock, {
      props: { block: { type: "future-kind" }, threadId: "t1", conversation: conversation() },
    });
    expect(screen.getByRole("status").textContent).toContain("Unsupported chat content (future-kind)");
  });

  it("renders an agent view in a lazy sandboxed frame", async () => {
    vi.stubGlobal("IntersectionObserver", ImmediateIntersectionObserver);
    const { screen } = mount(ChatView, {
      props: { block: { type: "view", viewId: "0123456789abcdef0123456789abcdef", title: "Status", height: 240 } },
      commands: {
        bridge_call: () => ({ viewId: "0123456789abcdef0123456789abcdef", title: "Status", html: "<h1>Ready</h1>", bytes: 15 }),
        view_stage: () => "uxnan-view://localhost/0123456789abcdef0123456789abcdef",
      },
    });
    const iframe = await screen.findByTitle("Status");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.hasAttribute("allow")).toBe(false);
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(iframe.getAttribute("src")).toContain("uxnan-view://localhost/");
  });
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

  it("sends what the person typed on a question that takes their own answer", async () => {
    const c = conversation();
    const { screen, backend, user } = mount(ChatBlock, {
      props: {
        block: {
          type: "question",
          questionId: "q-own",
          questions: [
            { question: "Which licence?", options: [{ label: "MIT" }, { label: "Apache-2.0" }], custom: true },
            { question: "Which toppings?", options: [{ label: "Cheese" }], multiple: true, custom: true },
            { question: "Project name?", options: [], custom: true },
          ],
        },
        threadId: "t1",
        conversation: c,
      },
      commands: { bridge_call: () => ({ turnId: "" }) },
    });
    // A typed answer replaces a single pick.
    await user.click(screen.getByRole("button", { name: "MIT" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.type(screen.getByRole("textbox", { name: "Type your answer…" }), "BSD-3");
    await user.keyboard("{Enter}");
    // On a multiple question it joins the picks.
    await user.click(screen.getByRole("button", { name: "Cheese" }));
    await user.type(screen.getByRole("textbox", { name: "Type your answer…" }), "Olives{Enter}");
    // A question with no options is answered by typing alone.
    await user.type(screen.getByRole("textbox", { name: "Type your answer…" }), "Uxnan{Enter}");
    await until(() => backend.called("bridge_call"));
    expect(backend.lastCallTo("bridge_call")?.args).toEqual({
      method: "turn/send",
      params: {
        threadId: "t1",
        questionResponse: { questionId: "q-own", answers: [["BSD-3"], ["Cheese", "Olives"], ["Uxnan"]] },
      },
    });
  });

  it("asks several questions one at a time, and 1–9 pick an option", async () => {
    const c = conversation();
    const { screen, backend, user } = mount(ChatRequest, {
      props: {
        block: {
          type: "question",
          questionId: "q-2",
          questions: [
            { question: "Which database?", options: [{ label: "SQLite" }, { label: "Postgres" }] },
            { question: "Add tests?", options: [{ label: "Yes" }, { label: "No" }] },
          ],
        },
        threadId: "t1",
        conversation: c,
        keys: true,
      },
      commands: { bridge_call: () => ({ turnId: "" }) },
    });
    expect(screen.getByText("1 of 2")).toBeTruthy();
    expect(screen.queryByText("Add tests?")).toBeNull();
    // A single choice answers its question and moves on.
    await user.keyboard("2");
    await until(() => screen.queryByText("Add tests?") !== null);
    expect(screen.getByText("2 of 2")).toBeTruthy();
    // Back shows the first answer still picked.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: /Postgres/ }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.keyboard("1");
    await user.click(screen.getByRole("button", { name: "Answer" }));
    await until(() => backend.called("bridge_call"));
    expect(backend.lastCallTo("bridge_call")?.args).toEqual({
      method: "turn/send",
      params: {
        threadId: "t1",
        questionResponse: { questionId: "q-2", answers: [["Postgres"], ["Yes"]] },
      },
    });
  });

  it("never takes a number typed in a field", async () => {
    const { screen, user } = mount(ChatRequest, {
      props: {
        block: {
          type: "question",
          questionId: "q-3",
          questions: [{ question: "Which?", options: [{ label: "A" }, { label: "B" }] }],
        },
        threadId: "t1",
        conversation: conversation(),
        keys: true,
      },
    });
    const field = document.createElement("textarea");
    document.body.appendChild(field);
    field.focus();
    await user.keyboard("2");
    expect(screen.getByRole("button", { name: /B/ }).getAttribute("aria-pressed")).toBe("false");
    field.remove();
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

  it("labels a block type it does not know", () => {
    const { screen } = mount(ChatBlock, {
      props: { block: { type: "from-the-future" }, threadId: "t1", conversation: conversation() },
    });
    expect(screen.getByRole("status").textContent).toContain("Unsupported chat content (from-the-future)");
  });
});

describe("ChatWorkGroup", () => {
  const blocks = [
    { type: "command_execution", command: "npm test", exitCode: 1, output: "1 failing" },
    { type: "command_execution", command: "ls", exitCode: 0 },
    { type: "diff", filename: "src/a.ts", additions: 3, deletions: 1 },
  ];

  it("sums up a settled run of steps and opens back to them", async () => {
    const { screen, user } = mount(ChatWorkGroup, {
      props: { parts: blocks, live: false, turnId: "x", conversation: conversation() },
    });
    expect(screen.getByText("Ran 2 commands · 1 edit")).toBeTruthy();
    expect(screen.getByText("1 failed")).toBeTruthy();
    expect(folded(screen.queryByText("npm test"))).toBe(true);
    await user.click(screen.getByText("Ran 2 commands · 1 edit"));
    await until(() => !folded(screen.queryByText("npm test")));
    expect(screen.getByText("exit 1")).toBeTruthy();
  });

  it("stays open while the turn runs", () => {
    const { screen } = mount(ChatWorkGroup, {
      props: { parts: blocks, live: true, turnId: "x", conversation: conversation() },
    });
    expect(screen.getByText("npm test")).toBeTruthy();
    expect(screen.getByText("src/a.ts")).toBeTruthy();
  });

  it("heads a summarized run with its counts and reads its steps when opened", async () => {
    // 250 steps: the bridge serves them in two pages, the group draws 100 at a time.
    const steps = Array.from({ length: 250 }, (_, i) => preview(i + 1));
    const { c, calls } = bridgeConversation({
      "turn/steps": (p: { from: number }) =>
        p.from === 1 ? { steps: steps.slice(0, 150), next: 151 } : { steps: steps.slice(150) },
    });
    const settled = run(1, 250, { commands: 240, edits: 10, failed: 2 });
    const { screen, user } = mount(ChatWorkGroup, {
      props: { parts: [settled], live: false, turnId: "x", conversation: c },
    });
    expect(screen.getByText("Ran 240 commands · 10 edits")).toBeTruthy();
    expect(screen.getByText("2 failed")).toBeTruthy();
    // Folded, it asks for nothing.
    expect(calls).toEqual([]);

    await user.click(screen.getByText("Ran 240 commands · 10 edits"));
    await until(() => screen.queryByText("step 100") !== null);
    expect(calls).toEqual([{ method: "turn/steps", params: { threadId: "t1", turnId: "x", from: 1, to: 250 } }]);
    expect(screen.queryByText("step 101")).toBeNull();

    // The next window is already read; the one after needs the next page.
    await user.click(screen.getByRole("button", { name: "Show 100 more steps" }));
    await until(() => screen.queryByText("step 200") !== null);
    await user.click(screen.getByRole("button", { name: "Show 50 more steps" }));
    await until(() => screen.queryByText("step 250") !== null);
    expect(calls.map((call) => (call.params as { from: number }).from)).toEqual([1, 151]);
    expect(screen.queryByRole("button", { name: /more steps?$/ })).toBeNull();
  });

  it("shows a live run's latest step with its earlier ones a click away", async () => {
    const { c, calls } = bridgeConversation({ "turn/steps": { steps: [preview(1), preview(2), preview(3)] } });
    const live = { type: "command_execution", index: 4, command: "npm test", status: "running" };
    const { screen, user } = mount(ChatWorkGroup, {
      props: { parts: [run(1, 3), live], live: true, turnId: "x", conversation: c },
    });
    // One group: the run's counts and the live step together.
    expect(screen.getByText("Ran 4 commands")).toBeTruthy();
    expect(screen.getByText("step 3")).toBeTruthy();
    expect(screen.getByText("npm test")).toBeTruthy();
    expect(calls).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Show 2 earlier steps" }));
    await until(() => screen.queryByText("step 1") !== null);
    expect(screen.getByText("step 2")).toBeTruthy();
  });

  it("says why a run's steps could not be read, and reads them again on Retry", async () => {
    let fail = true;
    const { c, calls } = bridgeConversation({
      "turn/steps": () => {
        if (fail) throw new Error("Response too large (-32011)");
        return { steps: [preview(0), preview(1)] };
      },
    });
    const { screen, user } = mount(ChatWorkGroup, {
      props: { parts: [run(0, 2)], live: false, turnId: "x", conversation: c },
    });
    await user.click(screen.getByText("Ran 2 commands"));
    await until(() => screen.queryByText("This is too large to load here.") !== null);
    fail = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await until(() => screen.queryByText("step 1") !== null);
    expect(calls).toHaveLength(2);
  });
});

describe("ChatActivity", () => {
  const tool = (toolName: string, kind: string, target: string) => ({ type: "tool", toolName, kind, target });

  it("says what a tool did from its kind, whatever the agent called it", () => {
    const rows: [Record<string, unknown>, string, string][] = [
      [tool("view_file", "read", "notes.txt"), "Read", "notes.txt"],
      [tool("Grep", "search", "alpha · src"), "Searched", "alpha · src"],
      [tool("list_dir", "list", "src"), "Listed", "src"],
      [tool("WebFetch", "fetch", "https://example.com"), "Fetched", "https://example.com"],
      [tool("search_web", "web_search", "uxnan"), "Searched the web", "uxnan"],
      [tool("mcp__uxnan-browser__browser_open", "mcp", "http://localhost"), "uxnan-browser · browser_open", "http://localhost"],
      [tool("execute", "other", "run()"), "execute", "run()"],
    ];
    for (const [block, verb, detail] of rows) {
      const { screen } = mount(ChatActivity, { props: { block } });
      expect(screen.getByText(verb)).toBeTruthy();
      expect(screen.getByText(detail)).toBeTruthy();
      screen.unmount();
    }
  });

  it("offers a cut output whole, read from the bridge", async () => {
    const { c, calls } = bridgeConversation({
      "turn/step": { block: { type: "command_execution", command: "npm test", output: "first line\n…\nlast line" } },
    });
    const block = preview(7, { command: "npm test", output: "last line", outputChars: 40_000 });
    const { screen, user } = mount(ChatActivity, { props: { block, turnId: "x", conversation: c } });
    await user.click(screen.getByText("npm test"));
    await until(() => screen.queryByRole("button", { name: "Show the full output" }) !== null);
    expect(calls).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Show the full output" }));
    await until(() => screen.queryByText(/first line/) !== null);
    expect(calls).toEqual([{ method: "turn/step", params: { threadId: "t1", turnId: "x", index: 7 } }]);
    expect(screen.queryByRole("button", { name: "Show the full output" })).toBeNull();
  });

  it("reads an edit's diff when it opens: a preview never carries one", async () => {
    const { c, calls } = bridgeConversation({
      "turn/step": { block: { type: "diff", filename: "a.ts", diff: "@@ -1 +1 @@\n-old\n+new\n" } },
    });
    const block = { type: "diff", index: 3, filename: "a.ts", additions: 1, deletions: 1, diffChars: 24 };
    const { screen, user } = mount(ChatActivity, { props: { block, turnId: "x", conversation: c } });
    expect(calls).toEqual([]);
    await user.click(screen.getByText("a.ts"));
    await until(() => calls.length === 1);
    expect(calls[0]).toEqual({ method: "turn/step", params: { threadId: "t1", turnId: "x", index: 3 } });
  });

  it("opens a thought as Markdown, and reads a cut one whole on demand", async () => {
    const { c, calls } = bridgeConversation({
      "turn/step": { block: { type: "thinking", text: "First, *read* it. Then the whole rest." } },
    });
    const block = { type: "thinking", index: 4, text: "First, *read* it.", textChars: 38 };
    const { screen, user } = mount(ChatActivity, { props: { block, live: false, turnId: "x", conversation: c } });
    expect(screen.getByText("Thought")).toBeTruthy();
    expect(screen.getByText("First, read it.")).toBeTruthy();
    await user.click(screen.getByText("Thought"));
    await user.click(await screen.findByRole("button", { name: "Show all of it" }));
    await until(() => screen.queryByText(/Then the whole rest/) !== null);
    expect(calls).toEqual([{ method: "turn/step", params: { threadId: "t1", turnId: "x", index: 4 } }]);
    // Rendered as Markdown, not as its source.
    expect(screen.getByText("read").tagName).toBe("EM");
  });

  it("animates a running step only while its turn is live", () => {
    const block = { type: "command_execution", command: "npm test", status: "running", blockId: "c1" };
    const live = mount(ChatActivity, { props: { block, live: true } });
    expect(live.screen.getByRole("status")).toBeTruthy();
    live.screen.unmount();
    const settled = mount(ChatActivity, { props: { block, live: false } });
    expect(settled.screen.queryByRole("status")).toBeNull();
  });

  it("draws a subagent as its own card that opens its report, and marks one that failed", async () => {
    const block = {
      type: "subagent",
      state: { id: "s1", name: "Count lines", status: "completed", output: "Three lines." },
    };
    const { screen, user } = mount(ChatBlock, { props: { block, threadId: "t1", conversation: conversation() } });
    expect(screen.getByText("Subagent")).toBeTruthy();
    await user.click(screen.getByText("Count lines"));
    await until(() => !folded(screen.queryByText("Three lines.")));
    screen.unmount();
    const failed = mount(ChatBlock, {
      props: {
        block: { type: "subagent", state: { id: "s2", name: "Audit", status: "error" } },
        threadId: "t1",
        conversation: conversation(),
      },
    });
    expect(failed.screen.getByText("failed")).toBeTruthy();
    failed.screen.unmount();
    // A running subagent of a turn that has ended does not keep working.
    const settled = mount(ChatBlock, {
      props: {
        block: { type: "subagent", state: { id: "s3", name: "Scan", status: "running" } },
        threadId: "t1",
        conversation: conversation(),
        live: false,
      },
    });
    expect(settled.screen.queryByRole("status")).toBeNull();
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

  it("lists the files a summarized run changed", () => {
    const turn: Turn = {
      ...settled,
      messages: [
        settled.messages[0]!,
        {
          ...settled.messages[1]!,
          segments: [
            run(0, 3, {
              commands: 2,
              edits: 1,
              files: [{ filename: "src/app.ts", additions: 2, deletions: 2 }],
            }),
            { type: "text", text: "The build passes now." },
          ],
        },
      ],
    };
    const { screen } = mount(ChatTurnView, {
      props: { turn, threadId: "t1", cwd: "/repo", conversation: conversation() },
    });
    expect(screen.getByText("1 file changed")).toBeTruthy();
    expect(screen.getByText("src/app.ts")).toBeTruthy();
  });

  it("shows the thought being written as Thinking, and settles it when the agent moves on", async () => {
    const c = conversation();
    const live: Turn = {
      ...settled,
      status: "streaming",
      completedAt: undefined,
      messages: [
        settled.messages[0]!,
        {
          ...settled.messages[1]!,
          segments: [
            { type: "thinking", text: "Read the **config** first." },
            { type: "command_execution", index: 1, command: "cat vite.config.js", status: "completed" },
            { type: "thinking", text: "Now the `build` script." },
          ],
        },
      ],
    } as Turn;
    c.adoptPage({ turns: [live], total: 1, activeTurnId: "turn-1" });
    const { screen } = mount(ChatTurnView, {
      props: { turn: live, threadId: "t1", cwd: "/repo", conversation: c },
    });
    // One group: thoughts sit among the commands, in their place.
    expect(screen.getByText("Ran 1 command · 2 thoughts")).toBeTruthy();
    expect(screen.getByText("Thought")).toBeTruthy();
    expect(screen.getByText("Read the config first.")).toBeTruthy();
    // (The label's shimmer draws it twice: once read, once as the glint.)
    expect(screen.getAllByText("Thinking").length).toBeGreaterThan(0);
    expect(screen.getByText("Now the build script.")).toBeTruthy();
    // Anything after it settles it.
    const moved = {
      ...live,
      messages: [
        live.messages[0]!,
        {
          ...live.messages[1]!,
          segments: [
            ...(live.messages[1]!.segments ?? []),
            { type: "command_execution", index: 3, command: "npm run build", status: "running" },
          ],
        },
      ],
    } as Turn;
    await screen.rerender({ turn: moved, threadId: "t1", cwd: "/repo", conversation: c });
    expect(screen.queryAllByText("Thinking")).toEqual([]);
    expect(screen.getAllByText("Thought")).toHaveLength(2);
  });

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

describe("ChatBlock compaction marker", () => {
  it("is one quiet line that still says why and by how much", () => {
    const c = chat.conversation("t-compact");
    const { screen } = mountWithProviders(ChatBlock, {
      props: {
        block: { type: "compaction", reason: "threshold", tokensBefore: 182_000, tokensAfter: 24_500 },
        threadId: "t-compact",
        conversation: c,
      },
    });
    const line = screen.getByText("Context compacted");
    expect(line.getAttribute("aria-label")).toBe(
      "Context compacted. Earlier context was summarized after reaching the agent's limit. Context reduced from 182K to about 24.5K tokens.",
    );
  });

  it("says why even when the agent reported no token counts", () => {
    const c = chat.conversation("t-compact-2");
    const { screen } = mountWithProviders(ChatBlock, {
      props: { block: { type: "compaction" }, threadId: "t-compact-2", conversation: c },
    });
    expect(screen.getByText("Context compacted").getAttribute("aria-label")).toBe(
      "Context compacted. Earlier messages were summarized to free context.",
    );
  });
});
