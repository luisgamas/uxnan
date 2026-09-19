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
import { orchestration } from "$lib/state/orchestration.svelte";
import { projects } from "$lib/state/projects.svelte";
import { app } from "$lib/state/app.svelte";
import { readInstanceText } from "$lib/terminal/instances";
import type { WorktreeEntry } from "$lib/types";

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

/** Resolve the `agent` argument of a create entry, or throw the message the
 *  caller reads. `null` when no agent was asked for. */
function agentFor(selector: unknown): { id: string; name: string } | null {
  if (selector === undefined || selector === null || String(selector).trim() === "") return null;
  const agent = app.findLaunchableAgent(String(selector));
  if (!agent) {
    const known = app.launchableAgents.map((a) => a.command.trim() || a.name).join(", ");
    throw new Error(`no configured agent matches \`${String(selector)}\`; known: ${known || "none"}`);
  }
  return { id: agent.id, name: agent.name };
}

/** Queue a first message for a just-launched agent. The broadcast queue holds it
 *  under backpressure until the agent is free, so it is never pasted into a
 *  TUI that is still starting. */
function queuePrompt(tabId: string, prompt: unknown): void {
  const text = typeof prompt === "string" ? prompt : "";
  if (!text.trim()) return;
  orchestration.send({ kind: "tabs", tabIds: [tabId] }, text);
}

/** The handlers, by method. Exported for the tests, which call them directly. A
 *  handler may return a promise; the bridge awaits it. */
export const handlers: Record<string, (params: Record<string, unknown>) => unknown> = {
  "terminal/list": () => {
    const tabs: ControlTab[] = [];
    for (const { tab, workspace } of terminals.tabsWithWorkspace()) {
      if (tab.kind !== "terminal") continue;
      tabs.push({
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
      });
    }
    return { tabs };
  },
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
  "worktree/adopt": async (p) => {
    const projectId = String(p.projectId ?? "");
    const worktree = p.worktree as WorktreeEntry;
    const agent = agentFor(p.agent);
    const tabId = await projects.adoptWorktree(projectId, worktree, agent ? agent.id : null);
    if (tabId) queuePrompt(tabId, p.prompt);
    return { terminal: tabId ? { id: tabId, agent: agent?.name } : null };
  },
  "terminal/create": (p) => {
    const worktree = String(p.worktree ?? "");
    const target = String(p.target ?? "local");
    const agent = agentFor(p.agent);
    const title = typeof p.title === "string" && p.title.trim() ? p.title.trim() : undefined;
    const targetOpt = target === "local" ? undefined : target;
    let tabId: string | null;
    if (agent) {
      const profile = app.findLaunchableAgent(agent.id)!;
      tabId = app.launchAgent(profile, { cwd: worktree, workspace: worktree, title, target: targetOpt });
    } else {
      tabId = terminals.create({ cwd: worktree, workspace: worktree, title, target: targetOpt });
    }
    if (!tabId) return { error: "the agent has no command to launch" };
    if (tabId && agent) queuePrompt(tabId, p.prompt);
    return { terminal: { id: tabId, agent: agent?.name } };
  },
  "agent/send": async (p) => {
    const terminal = String(p.terminal ?? "");
    const message = String(p.message ?? "");
    if (p.force === true) {
      // Now, whatever the agent is doing: one paste-and-submit, never keystrokes.
      await invoke("pty_paste_submit", { id: terminal, text: message });
      return { delivery: "forced" };
    }
    // Through the same backpressure queue the orchestration console uses: the
    // message leaves when the agent is free, one at a time per agent.
    const queued = orchestration.send({ kind: "tabs", tabIds: [terminal] }, message);
    if (queued === 0) return { error: `terminal ${terminal} is not a live agent's` };
    return { delivery: orchestration.pendingFor(terminal) > 0 ? "queued" : "delivered" };
  },
  "terminal/read": (p) => {
    const terminal = String(p.terminal ?? "");
    const lines = Number(p.lines ?? 120);
    const text = readInstanceText(terminal, lines);
    return text === null ? { text: null } : { text };
  },
  "run/start": (p) => {
    const id = String(p.run ?? "");
    const run = orchestrationRun.runs.find((r) => r.id === id);
    if (!run) return null;
    const errors = orchestrationRun.startRun(id);
    return { errors, status: run.status };
  },
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
export async function answer(
  request: ControlRequest,
): Promise<{ result?: unknown; error?: string }> {
  const handler = handlers[request.method];
  if (!handler) return { error: `the window has no handler for ${request.method}` };
  try {
    return { result: (await handler(request.params ?? {})) ?? null };
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
      void answer(e.payload).then(({ result, error }) =>
        invoke("control_respond", {
          id: e.payload.id,
          result: result ?? null,
          error: error ?? null,
        }).catch(() => {}),
      );
    });
  } catch {
    listening = false;
  }
}
