/**
 * The window's side of the control surface: what it answers when the backend
 * forwards a caller's question about tabs, files and runs — and, for the
 * `create` group, what it does when asked to adopt a worktree, open a terminal
 * or start a run.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { installFakeBackend, type FakeBackend } from "../../test/tauri";

const { terminals } = await import("$lib/state/terminals.svelte");
const { orchestrationRun } = await import("$lib/state/orchestrationRun.svelte");
const { orchestration } = await import("$lib/state/orchestration.svelte");
const { projects } = await import("$lib/state/projects.svelte");
const { app } = await import("$lib/state/app.svelte");
const { answer, startControlBridge } = await import("./bridge");

const WT = "C:/repo";
let backend: FakeBackend;

/** The tab the person is looking at: the active region's active tab. */
function activeTab(): string | undefined {
  const find = (node: { kind: string; id?: string; activeTabId?: string; children?: unknown[] } | null): string | undefined => {
    if (!node) return undefined;
    if (node.kind === "group") return node.id === terminals.activeGroupId ? node.activeTabId : undefined;
    for (const child of (node.children ?? []) as typeof node[]) {
      const hit = find(child);
      if (hit) return hit;
    }
    return undefined;
  };
  return find(terminals.root as Parameters<typeof find>[0]);
}

beforeEach(() => {
  backend = installFakeBackend({
    fs_read_file: () => ({ content: "", binary: false, tooLarge: false }),
    git_diff_head: () => "",
    term_buffers_set: () => undefined,
    control_respond: () => undefined,
    pty_create: () => true,
    pty_paste_submit: () => undefined,
    worktree_list: () => [{ path: WT, branch: "main", head: "abc", isMain: true }],
    worktree_status: () => ({ dirty: 0, ahead: 0, behind: 0 }),
  });
  terminals.root = null;
  terminals.workspaces = {};
  orchestrationRun.runs = [];
  orchestration.clearQueue();
  app.repos = [{ id: "repo-1", name: "repo", path: WT, worktrees: [], isGit: true }];
  app.settings.agentProfiles = [
    { id: "a-claude", name: "Claude Code", command: "claude", args: [] },
    { id: "a-none", name: "Broken", command: "", args: [] },
  ];
});

describe("the control bridge", () => {
  it("lists every terminal tab with its workspace and agent, and nothing else", async () => {
    terminals.setWorkspace(WT);
    const shell = terminals.create({ cwd: WT, title: "zsh" });
    const agent = terminals.create({ cwd: WT, title: "claude", agentName: "Claude Code" });
    terminals.openFile(`${WT}/src/a.ts`, WT);

    const { result } = await answer({ id: "r1", method: "terminal/list", params: null });
    const tabs = (result as { tabs: { id: string; workspace: string; agentName?: string }[] }).tabs;
    expect(tabs.map((t) => t.id).sort()).toEqual([shell, agent].sort());
    expect(tabs.every((t) => t.workspace === WT)).toBe(true);
    expect(tabs.find((t) => t.id === agent)?.agentName).toBe("Claude Code");
    expect(tabs.find((t) => t.id === shell)?.agentName).toBeUndefined();
  });

  it("reveals a terminal and opens a file or a diff where the backend says", async () => {
    terminals.setWorkspace(WT);
    const shell = terminals.create({ cwd: WT });
    terminals.setWorkspace("");
    await answer({ id: "r2", method: "terminal/reveal", params: { terminal: shell, workspace: WT } });
    expect(terminals.activeWorkspace).toBe(WT);
    expect(terminals.activePtyId()).toBe(shell);

    const opened = await answer({
      id: "r3",
      method: "file/open",
      params: { path: `${WT}/src/a.ts`, worktree: WT },
    });
    expect(opened.error).toBeUndefined();
    expect(terminals.activeFilePath).toBe(`${WT}/src/a.ts`);

    const diffed = await answer({
      id: "r4",
      method: "file/diff",
      params: { path: "src/b.ts", worktree: WT, staged: true },
    });
    expect(diffed.error).toBeUndefined();
    expect(terminals.isFileChangesOpen(WT, "src/b.ts", true)).toBe(true);
  });

  it("describes runs from the run store, and says null for one it does not have", async () => {
    orchestrationRun.runs = [
      {
        id: "run-1",
        title: "Release",
        createdAt: 1,
        updatedAt: 2,
        status: "running",
        seq: 2,
        steps: [
          {
            id: "s1",
            title: "Build",
            kind: "headless",
            target: { kind: "agent", agent: "codex" } as never,
            prompt: "build it",
            dependsOn: [],
            status: "completed",
            output: "done",
          } as never,
          {
            id: "s2",
            title: "Test",
            kind: "headless",
            target: { kind: "agent", agent: "codex" } as never,
            prompt: "test it",
            dependsOn: ["s1"],
            status: "running",
          } as never,
        ],
      },
    ];
    const list = (await answer({ id: "r5", method: "run/list", params: null })).result as {
      runs: { id: string; steps: number; completed: number }[];
    };
    expect(list.runs).toEqual([expect.objectContaining({ id: "run-1", steps: 2, completed: 1 })]);
    const show = (await answer({ id: "r6", method: "run/show", params: { run: "run-1" } }))
      .result as { steps: { id: string; output: string | null }[] };
    expect(show.steps.map((s) => s.output)).toEqual(["done", null]);
    expect((await answer({ id: "r7", method: "run/show", params: { run: "nope" } })).result).toBeNull();
  });

  it("answers an unknown method with an error, never with silence", async () => {
    const out = await answer({ id: "r8", method: "shell/exec", params: null });
    expect(out.error).toContain("shell/exec");
    expect(out.result).toBeUndefined();
  });

  it("replies to the backend through control_respond", async () => {
    await startControlBridge();
    backend.emit("control:request", { id: "r9", method: "run/list", params: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(backend.lastCallTo("control_respond")?.args).toEqual({
      id: "r9",
      result: { runs: [] },
      error: null,
    });
  });
});

describe("the create group, on the window's side", () => {
  const created = { path: `${WT}-worktrees/feat-x`, branch: "feat/x", head: "def", isMain: false };

  it("adopts a created worktree in the background: listed, agent launched, prompt queued, focus untouched", async () => {
    backend.setCommands({
      worktree_list: () => [{ path: WT, branch: "main", head: "abc", isMain: true }, created],
    });
    // The person is looking at the main worktree, at a shell of their own.
    terminals.setWorkspace(WT);
    const theirs = terminals.create({ cwd: WT, title: "mine" });
    projects.activeWorktreePath = WT;
    const out = await answer({
      id: "c1",
      method: "worktree/adopt",
      params: { projectId: "repo-1", worktree: created, agent: "claude", prompt: "start here" },
    });
    expect(out.error).toBeUndefined();
    const terminal = (out.result as { terminal: { id: string; agent: string } }).terminal;
    expect(terminal.agent).toBe("Claude Code");
    // The agent's tab lives in the new worktree's workspace, which is mounted
    // (its shell spawns) — but the person's worktree, workspace and tab are
    // exactly where they were: what an agent creates leaves a trace, it does
    // not take the seat. `terminal/reveal` is the entry that moves the focus.
    const tab = terminals.findTab(terminal.id);
    expect(tab?.kind === "terminal" && tab.agentName).toBe("Claude Code");
    expect(terminals.mountedWorkspaceKeys).toContain(created.path);
    expect(projects.activeWorktreePath).toBe(WT);
    expect(terminals.activeWorkspace).toBe(WT);
    expect(activeTab()).toBe(theirs);
    // …and the first message is held for that tab by the backpressure queue
    // (queued, or already in flight through a paste — never typed blindly).
    const delivered = backend.lastCallTo("pty_paste_submit")?.args as { id?: string } | undefined;
    expect(delivered?.id === terminal.id || orchestration.pendingFor(terminal.id) > 0).toBe(true);
  });

  it("adopts without an agent when none is asked, and refuses an agent it does not know", async () => {
    const plain = await answer({
      id: "c2",
      method: "worktree/adopt",
      params: { projectId: "repo-1", worktree: created },
    });
    expect((plain.result as { terminal: unknown }).terminal).toBeNull();

    const unknown = await answer({
      id: "c3",
      method: "worktree/adopt",
      params: { projectId: "repo-1", worktree: created, agent: "gpt-9" },
    });
    expect(unknown.error).toContain("no configured agent matches `gpt-9`");
    expect(unknown.error).toContain("claude");
  });

  it("opens a terminal in a worktree, plain or with an agent by name, command or id", async () => {
    terminals.setWorkspace(WT);
    const theirs = terminals.create({ cwd: WT, title: "mine" });
    const plain = await answer({
      id: "c4",
      method: "terminal/create",
      params: { worktree: WT, title: "build" },
    });
    const plainId = (plain.result as { terminal: { id: string } }).terminal.id;
    const plainTab = terminals.findTab(plainId);
    expect(plainTab?.kind === "terminal" && plainTab.cwd).toBe(WT);
    expect(plainTab?.title).toBe("build");
    // Opened in the background: it is in the workspace, not the active tab.
    expect(activeTab()).toBe(theirs);

    for (const agent of ["Claude Code", "claude", "a-claude"]) {
      const out = await answer({
        id: `c5-${agent}`,
        method: "terminal/create",
        params: { worktree: WT, agent },
      });
      const t = (out.result as { terminal: { id: string; agent: string } }).terminal;
      expect(t.agent).toBe("Claude Code");
      const tab = terminals.findTab(t.id);
      expect(tab?.kind === "terminal" && tab.agentName).toBe("Claude Code");
    }

    // A profile with no command is not launchable, so it is not an agent a
    // caller can name: refused with the ones that are.
    const broken = await answer({
      id: "c6",
      method: "terminal/create",
      params: { worktree: WT, agent: "Broken" },
    });
    expect(broken.error).toContain("no configured agent matches `Broken`");
    expect(broken.error).toContain("claude");
  });

  it("queues a message for a live agent, forces one on request, and refuses a shell", async () => {
    terminals.setWorkspace(WT);
    const shell = terminals.create({ cwd: WT, title: "zsh" });
    const agent = terminals.create({ cwd: WT, title: "claude", agentName: "Claude Code", agentCommand: "claude" });

    const queued = await answer({
      id: "s1",
      method: "agent/send",
      params: { terminal: agent, message: "continue", force: false },
    });
    const delivery = (queued.result as { delivery: string }).delivery;
    expect(["queued", "delivered"]).toContain(delivery);

    const forced = await answer({
      id: "s2",
      method: "agent/send",
      params: { terminal: agent, message: "stop", force: true },
    });
    expect((forced.result as { delivery: string }).delivery).toBe("forced");
    expect(backend.lastCallTo("pty_paste_submit")?.args).toEqual({ id: agent, text: "stop" });

    const refused = await answer({
      id: "s3",
      method: "agent/send",
      params: { terminal: shell, message: "hi", force: false },
    });
    expect((refused.result as { error: string }).error).toContain("not a live agent");
  });

  it("reads a terminal's screen, or says there is none", async () => {
    const out = await answer({ id: "s4", method: "terminal/read", params: { terminal: "nope", lines: 10 } });
    expect((out.result as { text: string | null }).text).toBeNull();
  });

  it("starts a saved run through the engine and reports validation refusals", async () => {
    orchestrationRun.runs = [
      { id: "run-empty", title: "Empty", createdAt: 1, updatedAt: 1, status: "draft", seq: 0, steps: [] },
    ];
    const refused = await answer({ id: "c7", method: "run/start", params: { run: "run-empty" } });
    const r = refused.result as { errors: string[]; status: string };
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.status).toBe("draft");
    expect((await answer({ id: "c8", method: "run/start", params: { run: "nope" } })).result).toBeNull();
  });
});

describe("a run driven by a coordinator", () => {
  async function ask<T>(id: string, method: string, params: Record<string, unknown>): Promise<T> {
    const out = await answer({ id, method, params });
    expect(out.error, `${method}: ${out.error}`).toBeUndefined();
    return out.result as T;
  }

  it("runs the coordinator loop: create, task, worker, report, inbox, finish", async () => {
    terminals.setWorkspace(WT);
    const run = await ask<{ id: string; status: string }>("d1", "run/create", {
      title: "Split the work",
      coordinator: "coord-tab",
    });
    expect(run.status).toBe("running");
    // An empty driven run stays running: it is waiting for tasks, not done.
    const listed = await ask<{ run: { status: string; driven: boolean }; tasks: unknown[]; inbox: number }>(
      "d2",
      "task/list",
      { run: run.id },
    );
    expect(listed.run).toMatchObject({ status: "running", driven: true });
    expect(listed.tasks).toEqual([]);

    const t1 = await ask<{ id: string; status: string }>("d3", "task/create", {
      run: run.id,
      title: "Lexer",
      prompt: "Write the lexer.",
    });
    expect(t1).toEqual({ id: "s1", status: "ready" });
    const t2 = await ask<{ id: string; status: string }>("d4", "task/create", {
      run: run.id,
      title: "Parser",
      prompt: "Use {{steps.s1.output}} to write the parser.",
      dependsOn: ["s1"],
    });
    expect(t2).toEqual({ id: "s2", status: "pending" });

    // The worker: a terminal the backend opened, bound to the task; the
    // preamble + prompt is queued into it, naming the dispatch.
    const worker = terminals.create({ cwd: WT, title: "s1", agentName: "Claude Code", agentCommand: "claude" });
    const bound = await ask<{ dispatchId: string }>("d5", "worker/start", {
      run: run.id,
      task: "s1",
      terminal: worker,
      agent: "claude",
      worktree: WT,
    });
    expect(bound.dispatchId).toBe("s1.1");
    expect(orchestration.pendingFor(worker) > 0 || backend.lastCallTo("pty_paste_submit") !== undefined).toBe(true);
    const tasks = (await ask<{ tasks: { id: string; status: string; dispatchId?: string; terminal?: string }[] }>(
      "d6",
      "task/list",
      { run: run.id },
    )).tasks;
    expect(tasks[0]).toMatchObject({ id: "s1", status: "running", dispatchId: "s1.1", terminal: worker });

    // A report from a stale dispatch is refused; the current one completes the
    // task, the dependent becomes ready, and the inbox says so.
    const stale = await ask<{ accepted: boolean; reason?: string }>("d7", "orchestration/report", {
      agentId: worker,
      type: "result",
      text: "old",
      taskId: "s1",
      dispatchId: "s1.0",
    });
    expect(stale.accepted).toBe(false);
    expect(stale.reason).toContain("stale");
    const fresh = await ask<{ accepted: boolean; stepId?: string }>("d8", "orchestration/report", {
      agentId: worker,
      type: "result",
      text: "tokens: 12 kinds",
      summary: "lexer done",
      taskId: "s1",
      dispatchId: "s1.1",
      outcome: "success",
    });
    expect(fresh).toMatchObject({ accepted: true, stepId: "s1" });
    const after = (await ask<{ tasks: { id: string; status: string; output: string | null }[] }>(
      "d9",
      "task/list",
      { run: run.id },
    )).tasks;
    expect(after[0]).toMatchObject({ id: "s1", status: "completed", output: "tokens: 12 kinds" });
    expect(after[1]).toMatchObject({ id: "s2", status: "ready" });

    const box = await ask<{ messages: { deliveryId: string; type: string; stepId: string; dispatchId?: string; text: string }[] }>(
      "d10",
      "inbox/check",
      { run: run.id },
    );
    expect(box.messages).toHaveLength(1);
    expect(box.messages[0]).toMatchObject({ deliveryId: "m1", type: "worker_done", stepId: "s1", dispatchId: "s1.1", text: "tokens: 12 kinds" });
    // Unacknowledged, it is delivered again; acknowledged, it is gone.
    expect((await ask<{ messages: unknown[] }>("d11", "inbox/check", { run: run.id })).messages).toHaveLength(1);
    const acked = await ask<{ messages: unknown[]; acked: number }>("d12", "inbox/check", { run: run.id, ack: ["m1"] });
    expect(acked).toMatchObject({ messages: [], acked: 1 });

    // Closing a task by hand, and finishing the run.
    const closed = await ask<{ id: string; status: string }>("d13", "task/update", {
      run: run.id,
      task: "s2",
      status: "skipped",
      output: "not needed",
    });
    expect(closed).toEqual({ id: "s2", status: "skipped" });
    const done = await ask<{ id: string; status: string }>("d14", "run/finish", {
      run: run.id,
      outcome: "success",
      summary: "all good",
    });
    expect(done.status).toBe("completed");
    expect(orchestrationRun.runById(run.id)?.driven).toMatchObject({ coordinator: "coord-tab", outcome: "success", summary: "all good" });
  });

  it("carries a worker's question to the coordinator as a gate, and its answer back", async () => {
    terminals.setWorkspace(WT);
    const run = await ask<{ id: string }>("q1", "run/create", { title: "Q", coordinator: "coord-tab" });
    await ask("q2", "task/create", { run: run.id, title: "Migrate", prompt: "Migrate the db." });
    const worker = terminals.create({ cwd: WT, title: "s1", agentName: "Codex", agentCommand: "codex" });
    await ask("q3", "worker/start", { run: run.id, task: "s1", terminal: worker, agent: "claude", worktree: WT });

    const filed = await ask<{ runId: string; questionId: string }>("q4", "question/ask", {
      terminal: worker,
      question: "Drop the legacy table?",
      options: ["yes", "no"],
    });
    expect(filed).toEqual({ runId: run.id, questionId: "s2" });
    const pending = await ask<{ answered: boolean }>("q5", "question/status", { question: "s2" });
    expect(pending.answered).toBe(false);
    const box = await ask<{ messages: { type: string; stepId: string; text: string }[] }>("q6", "inbox/check", { run: run.id });
    expect(box.messages[0]).toMatchObject({ type: "question", stepId: "s2" });
    expect(box.messages[0].text).toContain("Options: yes | no");
    // The gate is a real step of the run: the person sees it in the console.
    const gate = orchestrationRun.runById(run.id)?.steps.find((s) => s.id === "s2");
    expect(gate?.kind).toBe("gate");
    expect(gate?.gate).toMatchObject({ resolver: "coordinator", askedBy: { stepId: "s1", dispatchId: "s1.1" } });

    await ask("q7", "question/answer", { run: run.id, question: "s2", answer: "no, keep it" });
    const answered = await ask<{ answered: boolean; answer: string; decision: string }>("q8", "question/status", { question: "s2" });
    expect(answered).toMatchObject({ answered: true, answer: "no, keep it", decision: "approve" });

    // A terminal that is no worker cannot ask.
    const stranger = await answer({ id: "q9", method: "question/ask", params: { terminal: "nobody", question: "?" } });
    expect((stranger.result as { error: string }).error).toContain("not a worker");
  });
});

describe("the launch budget", () => {
  it("refuses an agent launch past the resource policy's concurrency, with the numbers", async () => {
    terminals.setWorkspace(WT);
    const cap = orchestrationRun.concurrencyCap;
    expect(cap).toBeGreaterThan(0);
    for (let i = 0; i < cap; i++) {
      terminals.create({ cwd: WT, title: `agent ${i}`, agentName: "Claude Code", agentCommand: "claude" });
    }
    // A plain terminal is not budgeted; an agent is.
    const shell = await answer({ id: "b1", method: "terminal/create", params: { worktree: WT, title: "shell" } });
    expect(shell.error).toBeUndefined();
    const refused = await answer({ id: "b2", method: "terminal/create", params: { worktree: WT, agent: "claude" } });
    const out = refused.result as { error?: string; busy?: boolean; live?: number; cap?: number };
    expect(out.busy).toBe(true);
    expect(out.live).toBe(cap);
    expect(out.cap).toBe(cap);
    expect(out.error).toContain("launch budget");
    // The same answer the backend asks for before creating a worktree with an agent.
    const admit = await answer({ id: "b3", method: "launch/admit", params: {} });
    expect((admit.result as { busy?: boolean }).busy).toBe(true);
    // Once an agent has exited, the next launch is admitted again.
    const agents = orchestrationRun.liveAgents;
    expect(agents).toHaveLength(cap);
    terminals.handleShellExit(agents[0].tabId);
    expect((await answer({ id: "b4", method: "launch/admit", params: {} })).result).toEqual({ ok: true });
  });
});

describe("unattended launches", () => {
  /** Open a terminal with an agent through the bridge, read what went on its
   *  command line and environment, and let it go so the budget is free again. */
  async function launch(agent: string, params: Record<string, unknown> = {}) {
    const out = await answer({
      id: `u-${agent}-${JSON.stringify(params)}`,
      method: "terminal/create",
      params: { worktree: WT, agent, ...params },
    });
    expect(out.error).toBeUndefined();
    const r = out.result as { terminal: { id: string }; unattended?: string };
    const tab = terminals.findTab(r.terminal.id);
    const cmd = tab?.kind === "terminal" ? (tab.runCommand ?? "") : "";
    const env = tab?.kind === "terminal" ? Object.fromEntries(tab.env ?? []) : {};
    terminals.handleShellExit(r.terminal.id);
    return { mode: r.unattended, cmd, env };
  }

  beforeEach(() => {
    terminals.setWorkspace(WT);
    app.settings.agentProfiles = [
      { id: "a-claude", name: "Claude Code", command: "claude", args: [] },
      { id: "a-codex", name: "Codex", command: "codex", args: [] },
      { id: "a-plan", name: "Planner", command: "claude", args: ["--permission-mode", "plan"] },
      { id: "a-grok", name: "Grok", command: "grok", args: [] },
      { id: "a-goose", name: "Goose", command: "goose", args: [], env: [{ key: "NO_COLOR", value: "1" }] },
      { id: "a-opencode", name: "OpenCode", command: "opencode", args: [] },
    ];
  });

  it("adds the CLI's reviewed automatic mode on request, and says when it cannot", async () => {
    // Applied: the mode goes on the command line.
    const claude = await launch("claude", { unattended: true });
    expect(claude.mode).toBe("applied");
    expect(claude.cmd).toContain("--permission-mode auto");
    const codex = await launch("codex", { unattended: true });
    expect(codex.mode).toBe("applied");
    expect(codex.cmd).toContain("--approve-for-me");
    // Applied through the environment, next to the profile's own variables,
    // for the CLI that reads its mode from there.
    const goose = await launch("goose", { unattended: true });
    expect(goose.mode).toBe("applied");
    expect(goose.env).toEqual({ NO_COLOR: "1", GOOSE_MODE: "smart_approve" });
    expect(goose.cmd).not.toContain("GOOSE_MODE");
    // Not asked: nothing added, nothing reported.
    const plain = await launch("codex");
    expect(plain.mode).toBeUndefined();
    expect(plain.cmd).not.toContain("--approve-for-me");
    expect((await launch("goose")).env).toEqual({ NO_COLOR: "1" });
    // The profile already chose a mode: left alone.
    const planner = await launch("Planner", { unattended: true });
    expect(planner.mode).toBe("configured");
    expect(planner.cmd).toContain("--permission-mode plan");
    expect(planner.cmd).not.toContain("auto");
    // Only an edits-only tier for this CLI: on the command line, and said so.
    const grok = await launch("grok", { unattended: true });
    expect(grok.mode).toBe("partial");
    expect(grok.cmd).toContain("--permission-mode acceptEdits");
    // No tier known for this CLI: launched as configured, and said so.
    const opencode = await launch("opencode", { unattended: true });
    expect(opencode.mode).toBe("unsupported");
    expect(opencode.cmd).toBe("opencode");
  });

  it("launches a worker unattended by default, unless the caller or the agent's switch says otherwise", async () => {
    // A worker's launch with nothing said: the per-agent default, which is on.
    const worker = await launch("codex", { worker: true });
    expect(worker.mode).toBe("applied");
    expect(worker.cmd).toContain("--approve-for-me");
    // An explicit `false` wins over the default.
    const attended = await launch("codex", { worker: true, unattended: false });
    expect(attended.mode).toBeUndefined();
    expect(attended.cmd).not.toContain("--approve-for-me");
    // The agent's Settings switch off: the worker launches as configured, and
    // the receipt says nothing — unless the caller asks explicitly.
    app.settings.agentProfiles[1].workersUnattended = false;
    const off = await launch("codex", { worker: true });
    expect(off.mode).toBeUndefined();
    expect(off.cmd).not.toContain("--approve-for-me");
    const asked = await launch("codex", { worker: true, unattended: true });
    expect(asked.mode).toBe("applied");
    // A CLI with no tier launches as configured either way, and the default
    // says so in the receipt.
    const opencode = await launch("opencode", { worker: true });
    expect(opencode.mode).toBe("unsupported");
    expect(opencode.cmd).toBe("opencode");
    // The default is only a worker's: a terminal an agent opens stays attended.
    const terminal = await launch("codex");
    expect(terminal.mode).toBeUndefined();
  });
});
