// The window's side of the control surface.
//
// Terminal tabs, open files and orchestration runs are the window's state, so
// when a caller of the control surface (an agent's MCP tool, `uxnan-cli`) asks
// about them, the backend forwards the question here as a `control:request`
// event and waits for the one answer this module sends back with
// `control_respond`. The backend never reinterprets the layout it persists;
// this is the only place that knows what a tab is.
//
// Every handler is synchronous work over the stores. An unknown method, or a
// handler that throws, answers with an error message rather than silence — a
// caller waiting on the bridge would otherwise learn nothing until the timeout.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { terminals } from "$lib/state/terminals.svelte";
import { orchestrationRun } from "$lib/state/orchestrationRun.svelte";

/** What the backend sends. */
export interface ControlRequest {
  id: string;
  method: string;
  params: Record<string, unknown> | null;
}

/** A terminal tab as the control surface describes it (mirrors the backend's
 *  `TabView`). */
export interface ControlTab {
  id: string;
  title: string;
  workspace: string;
  cwd?: string;
  target: string;
  agentName?: string;
  agentCommand?: string;
  agentModel?: string;
  exited: boolean;
  asleep: boolean;
}

/** The handlers, by method. Exported for the tests, which call them directly. */
export const handlers: Record<string, (params: Record<string, unknown>) => unknown> = {
  "terminal/list": () => ({
    tabs: terminals.allTerminalTabs().map(({ workspace, tab }): ControlTab => ({
      id: tab.id,
      title: tab.customTitle ?? tab.title,
      workspace,
      cwd: tab.cwd,
      target: tab.target ?? "local",
      agentName: tab.agentName,
      agentCommand: tab.agentCommand,
      agentModel: tab.agentModel,
      exited: tab.exited,
      asleep: tab.asleep === true,
    })),
  }),
  "terminal/reveal": (p) => {
    const terminal = String(p.terminal ?? "");
    const workspace = String(p.workspace ?? "");
    terminals.revealTab(workspace, terminal);
    return { revealed: terminal };
  },
  "file/open": (p) => {
    const path = String(p.path ?? "");
    const worktree = String(p.worktree ?? "");
    const id = terminals.openFile(path, worktree || null, { workspace: worktree });
    return { tab: id };
  },
  "file/diff": (p) => {
    const path = String(p.path ?? "");
    const worktree = String(p.worktree ?? "");
    const staged = p.staged === true;
    const id = terminals.openFileChanges(worktree, path, staged, { workspace: worktree });
    return { tab: id };
  },
  "run/list": () => ({
    runs: orchestrationRun.runs.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      steps: r.steps.length,
      completed: r.steps.filter((s) => s.status === "completed").length,
    })),
  }),
  "run/show": (p) => {
    const id = String(p.run ?? "");
    const run = orchestrationRun.runs.find((r) => r.id === id);
    if (!run) return null;
    return {
      id: run.id,
      title: run.title,
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      steps: run.steps.map((s) => ({
        id: s.id,
        title: s.title,
        kind: s.kind,
        target: s.target,
        dependsOn: s.dependsOn,
        status: s.status,
        prompt: s.prompt,
        output: s.output ?? null,
      })),
    };
  },
};

/** Answer one request. Exported for the tests. */
export function answer(request: ControlRequest): { result?: unknown; error?: string } {
  const handler = handlers[request.method];
  if (!handler) return { error: `the window has no handler for ${request.method}` };
  try {
    return { result: handler(request.params ?? {}) ?? null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

let listening = false;

/** Subscribe to the backend's requests (once). Called from the root layout of
 *  the main window; a plain web preview has no event bus and stays silent. */
export async function startControlBridge(): Promise<void> {
  if (listening) return;
  listening = true;
  try {
    await listen<ControlRequest>("control:request", (e) => {
      const { result, error } = answer(e.payload);
      void invoke("control_respond", { id: e.payload.id, result: result ?? null, error: error ?? null }).catch(
        () => {},
      );
    });
  } catch {
    listening = false;
  }
}
