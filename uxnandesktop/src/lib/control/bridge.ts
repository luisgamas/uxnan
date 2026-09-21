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
import { picksPermissionMode, unattendedArgs } from "$lib/agentUnattended";
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
function agentFor(selector: unknown): { id: string; name: string; command: string; args: string[] } | null {
  if (selector === undefined || selector === null || String(selector).trim() === "") return null;
  const agent = app.findLaunchableAgent(String(selector));
  if (!agent) {
    const known = app.launchableAgents.map((a) => a.command.trim() || a.name).join(", ");
    throw new Error(`no configured agent matches \`${String(selector)}\`; known: ${known || "none"}`);
  }
  return { id: agent.id, name: agent.name, command: agent.command.trim(), args: agent.args };
}

/** What an `unattended` launch adds, and what the receipt says about it:
 *  `applied` (the CLI's reviewed automatic mode goes on the command line),
 *  `configured` (the profile's own args already pick a mode — left alone) or
 *  `unsupported` (no flag known for that CLI — launched as configured). */
function unattended(
  agent: { command: string; args: string[] },
  wanted: unknown,
): { extraArgs?: readonly string[]; unattended?: "applied" | "configured" | "unsupported" } {
  if (wanted !== true) return {};
  if (picksPermissionMode(agent.args)) return { unattended: "configured" };
  const args = unattendedArgs(agent.command);
  if (!args) return { unattended: "unsupported" };
  return { extraArgs: args, unattended: "applied" };
}

/** The launch budget: an agent started through the surface — a terminal with
 *  an agent, a worktree with one, a worker — counts against the resource
 *  policy's orchestration concurrency, the same cap the run engine dispatches
 *  by (plan 023, deterministic protections). A person clicking is not
 *  budgeted; a coordinator that would start a fifth worker on a cap of four is
 *  told *busy*, with the numbers, and waits for one to finish. */
export function admitAgentLaunch(): { ok: true } | { ok: false; error: string; busy: true; live: number; cap: number } {
  const live = orchestrationRun.liveAgents.length;
  const cap = orchestrationRun.concurrencyCap;
  if (live < cap) return { ok: true };
  return {
    ok: false,
    busy: true,
    live,
    cap,
    error: `the launch budget is spent: ${live} agents are running and the resource policy allows ${cap} at once — wait for one to finish (or raise the orchestration concurrency in Settings → Resources)`,
  };
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
  "launch/admit": () => admitAgentLaunch(),
  "worktree/adopt": async (p) => {
    const projectId = String(p.projectId ?? "");
    const worktree = p.worktree as WorktreeEntry;
    const agent = agentFor(p.agent);
    const mode = agent ? unattended(agent, p.unattended) : {};
    // In the background: the sidebar lists it and the agent runs, the person's
    // focus stays where it is (`terminal/reveal` is the entry that moves it).
    const tabId = await projects.adoptWorktree(
      projectId,
      worktree,
      agent ? agent.id : null,
      true,
      mode.extraArgs,
    );
    if (tabId) queuePrompt(tabId, p.prompt);
    return {
      terminal: tabId ? { id: tabId, agent: agent?.name } : null,
      ...(mode.unattended ? { unattended: mode.unattended } : {}),
    };
  },
  "terminal/create": (p) => {
    const worktree = String(p.worktree ?? "");
    const target = String(p.target ?? "local");
    const agent = agentFor(p.agent);
    if (agent) {
      const admitted = admitAgentLaunch();
      if (!admitted.ok) return admitted;
    }
    const mode = agent ? unattended(agent, p.unattended) : {};
    const title = typeof p.title === "string" && p.title.trim() ? p.title.trim() : undefined;
    const targetOpt = target === "local" ? undefined : target;
    let tabId: string | null;
    if (agent) {
      const profile = app.findLaunchableAgent(agent.id)!;
      tabId = app.launchAgent(profile, {
        cwd: worktree,
        workspace: worktree,
        title,
        target: targetOpt,
        background: true,
        extraArgs: mode.extraArgs,
      });
    } else {
      tabId = terminals.create({
        cwd: worktree,
        workspace: worktree,
        title,
        target: targetOpt,
        background: true,
      });
    }
    if (!tabId) return { error: "the agent has no command to launch" };
    if (tabId && agent) queuePrompt(tabId, p.prompt);
    return {
      terminal: { id: tabId, agent: agent?.name },
      ...(mode.unattended ? { unattended: mode.unattended } : {}),
    };
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
  // --- The coordinator's entries: a run driven through the control surface ---
  "orchestration/report": (p) =>
    orchestrationRun.applyAgentReport({
      agentId: String(p.agentId ?? ""),
      type: p.type === "progress" ? "progress" : "result",
      text: String(p.text ?? ""),
      summary: typeof p.summary === "string" ? p.summary : null,
      taskId: typeof p.taskId === "string" ? p.taskId : null,
      dispatchId: typeof p.dispatchId === "string" ? p.dispatchId : null,
      outcome: p.outcome === "failure" || p.outcome === "blocked" ? p.outcome : p.outcome === "success" ? "success" : null,
    }),
  "run/create": (p) => {
    const run = orchestrationRun.createDriven(
      String(p.title ?? ""),
      typeof p.coordinator === "string" && p.coordinator ? p.coordinator : undefined,
    );
    return { id: run.id, status: run.status };
  },
  "run/finish": (p) => {
    const outcome = p.outcome === "failure" || p.outcome === "blocked" ? p.outcome : "success";
    const run = orchestrationRun.finishRun(
      String(p.run ?? ""),
      outcome,
      typeof p.summary === "string" ? p.summary : undefined,
    );
    if (!run) return { error: `no driven run matches \`${String(p.run ?? "")}\`` };
    return { id: run.id, status: run.status };
  },
  "task/create": (p) => {
    const step = orchestrationRun.createTask(String(p.run ?? ""), {
      title: String(p.title ?? ""),
      prompt: String(p.prompt ?? ""),
      dependsOn: Array.isArray(p.dependsOn) ? p.dependsOn.map(String) : [],
      kind: p.kind === "headless" ? "headless" : "interactive",
      agent: typeof p.agent === "string" ? agentFor(p.agent)?.id : undefined,
      worktree: typeof p.worktree === "string" ? p.worktree : undefined,
      retry: p.retry === true,
    });
    if (!step) return { error: `no running driven run matches \`${String(p.run ?? "")}\`` };
    return { id: step.id, status: step.status };
  },
  "task/list": (p) => {
    const id = String(p.run ?? "");
    const run = orchestrationRun.runs.find((r) => r.id === id);
    if (!run) return { error: `no run matches \`${id}\`` };
    return {
      run: { id: run.id, title: run.title, status: run.status, driven: run.driven !== undefined },
      tasks: run.steps.map((s) => {
        const task: Record<string, unknown> = {
          id: s.id,
          title: s.title,
          kind: s.kind,
          status: s.status,
          dependsOn: s.dependsOn,
          prompt: s.prompt,
          attempts: s.attempts,
          output: s.output ?? null,
        };
        if (s.dispatchId) task.dispatchId = s.dispatchId;
        if (s.outcome) task.outcome = s.outcome;
        if (s.error) task.error = s.error;
        if (s.kind === "interactive" && s.target.tabId) task.terminal = s.target.tabId;
        if (s.kind === "gate" && s.gate) {
          task.question = {
            question: s.gate.question,
            options: s.gate.options,
            resolver: s.gate.resolver ?? "human",
            answered: s.gate.decision !== undefined,
            answer: s.gate.decision !== undefined ? s.gate.note : undefined,
            askedBy: s.gate.askedBy,
          };
        }
        return task;
      }),
      inbox: run.inbox?.length ?? 0,
    };
  },
  "task/update": (p) => {
    const status =
      p.status === "completed" || p.status === "failed" || p.status === "skipped" ? p.status : undefined;
    const step = orchestrationRun.updateTask(String(p.run ?? ""), String(p.task ?? ""), {
      title: typeof p.title === "string" ? p.title : undefined,
      prompt: typeof p.prompt === "string" ? p.prompt : undefined,
      dependsOn: Array.isArray(p.dependsOn) ? p.dependsOn.map(String) : undefined,
      status,
      output: typeof p.output === "string" ? p.output : undefined,
    });
    if (!step) return { error: `no task \`${String(p.task ?? "")}\` in driven run \`${String(p.run ?? "")}\`` };
    return { id: step.id, status: step.status };
  },
  "worker/start": (p) => {
    const agent = agentFor(p.agent);
    const bound = orchestrationRun.startWorker(String(p.run ?? ""), String(p.task ?? ""), {
      tabId: String(p.terminal ?? ""),
      agentType: agent?.command ?? String(p.agent ?? ""),
      workspace: String(p.worktree ?? ""),
    });
    return bound;
  },
  "inbox/check": (p) => {
    const box = orchestrationRun.inbox(String(p.run ?? ""), Array.isArray(p.ack) ? p.ack.map(String) : []);
    if (!box) return { error: `no run matches \`${String(p.run ?? "")}\`` };
    return { run: String(p.run), messages: box.messages, acked: box.acked };
  },
  "question/ask": (p) =>
    orchestrationRun.ask(
      String(p.terminal ?? ""),
      String(p.question ?? ""),
      Array.isArray(p.options) ? p.options.map(String) : undefined,
    ),
  "question/status": (p) => {
    const q = orchestrationRun.question(String(p.question ?? ""));
    if (!q) return { error: `no question matches \`${String(p.question ?? "")}\`` };
    return { run: q.runId, answered: q.answered, answer: q.answer ?? null, decision: q.decision ?? null };
  },
  "question/answer": (p) => {
    const ok = orchestrationRun.answer(
      String(p.run ?? ""),
      String(p.question ?? ""),
      String(p.answer ?? ""),
      p.decision === "reject" ? "reject" : "approve",
    );
    return ok ? { resolved: true } : { error: `no open question \`${String(p.question ?? "")}\` in run \`${String(p.run ?? "")}\`` };
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
