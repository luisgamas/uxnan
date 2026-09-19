/**
 * The window's side of the control surface: what it answers when the backend
 * forwards a caller's question about tabs, files and runs.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { installFakeBackend, type FakeBackend } from "../../test/tauri";

const { terminals } = await import("$lib/state/terminals.svelte");
const { orchestrationRun } = await import("$lib/state/orchestrationRun.svelte");
const { answer, startControlBridge } = await import("./bridge");

const WT = "C:/repo";
let backend: FakeBackend;

beforeEach(() => {
  backend = installFakeBackend({
    fs_read_file: () => ({ content: "", binary: false, tooLarge: false }),
    git_diff_head: () => "",
    term_buffers_set: () => undefined,
    control_respond: () => undefined,
  });
  terminals.root = null;
  terminals.workspaces = {};
  orchestrationRun.runs = [];
});

describe("the control bridge", () => {
  it("lists every terminal tab with its workspace and agent, and nothing else", () => {
    terminals.setWorkspace(WT);
    const shell = terminals.create({ cwd: WT, title: "zsh" });
    const agent = terminals.create({ cwd: WT, title: "claude", agentName: "Claude Code" });
    terminals.openFile(`${WT}/src/a.ts`, WT);

    const { result } = answer({ id: "r1", method: "terminal/list", params: null });
    const tabs = (result as { tabs: { id: string; workspace: string; agentName?: string }[] }).tabs;
    expect(tabs.map((t) => t.id).sort()).toEqual([shell, agent].sort());
    expect(tabs.every((t) => t.workspace === WT)).toBe(true);
    expect(tabs.find((t) => t.id === agent)?.agentName).toBe("Claude Code");
    expect(tabs.find((t) => t.id === shell)?.agentName).toBeUndefined();
  });

  it("reveals a terminal and opens a file or a diff where the backend says", () => {
    terminals.setWorkspace(WT);
    const shell = terminals.create({ cwd: WT });
    terminals.setWorkspace("");
    answer({ id: "r2", method: "terminal/reveal", params: { terminal: shell, workspace: WT } });
    expect(terminals.activeWorkspace).toBe(WT);
    expect(terminals.activePtyId()).toBe(shell);

    const opened = answer({
      id: "r3",
      method: "file/open",
      params: { path: `${WT}/src/a.ts`, worktree: WT },
    });
    expect(opened.error).toBeUndefined();
    expect(terminals.activeFilePath).toBe(`${WT}/src/a.ts`);

    const diffed = answer({
      id: "r4",
      method: "file/diff",
      params: { path: "src/b.ts", worktree: WT, staged: true },
    });
    expect(diffed.error).toBeUndefined();
    expect(terminals.isFileChangesOpen(WT, "src/b.ts", true)).toBe(true);
  });

  it("describes runs from the run store, and says null for one it does not have", () => {
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
    const list = answer({ id: "r5", method: "run/list", params: null }).result as {
      runs: { id: string; steps: number; completed: number }[];
    };
    expect(list.runs).toEqual([
      expect.objectContaining({ id: "run-1", steps: 2, completed: 1 }),
    ]);
    const show = answer({ id: "r6", method: "run/show", params: { run: "run-1" } }).result as {
      steps: { id: string; output: string | null }[];
    };
    expect(show.steps.map((s) => s.output)).toEqual(["done", null]);
    expect(answer({ id: "r7", method: "run/show", params: { run: "nope" } }).result).toBeNull();
  });

  it("answers an unknown method with an error, never with silence", () => {
    const out = answer({ id: "r8", method: "shell/exec", params: null });
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
