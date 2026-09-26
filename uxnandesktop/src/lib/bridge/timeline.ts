// How one turn of a chat is laid out: the agent's answer arrives as an ordered
// list of text runs and structured blocks (`segments`), and the timeline reads
// better grouped than flat —
//
//  - consecutive activity (commands, edits, tool calls, subagents) becomes one
//    work group, open while the turn runs and summarized once it settles;
//  - a settled turn folds everything before its closing answer behind one
//    "Worked for 1m 3s" line, so a long session reads as its conclusions;
//  - the files a turn changed are gathered into one card at its end.
//
// Pure: every input crossed a process boundary (the bridge), so each field is
// read defensively and an unknown shape is passed through as a lone block.

/** Block types that are a step of the agent's work rather than something to read or answer. */
const ACTIVITY_TYPES = new Set(["command_execution", "diff", "tool", "subagent"]);

export type TimelineItem =
  | { kind: "text"; text: string }
  | { kind: "work"; blocks: Record<string, unknown>[] }
  | { kind: "block"; block: unknown };

export interface WorkSummary {
  commands: number;
  edits: number;
  tools: number;
  agents: number;
  failed: number;
}

export interface ChangedFile {
  filename: string;
  additions: number;
  deletions: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function typeOf(part: unknown): string {
  const t = record(part)?.type;
  return typeof t === "string" ? t : "";
}

/** A text run of the answer, or null. */
export function textOf(part: unknown): string | null {
  const p = record(part);
  return p && p.type === "text" && typeof p.text === "string" ? p.text : null;
}

/** Whether a block is one step of the agent's work (a command, an edit, a tool call, a subagent). */
export function isActivity(part: unknown): boolean {
  return ACTIVITY_TYPES.has(typeOf(part));
}

/** Groups a turn's parts: runs of activity become one `work` item; blank text
 *  and the zero-text response boundaries disappear; and of the plans the turn
 *  carries, only the latest stays — an agent resends its whole to-do list on
 *  every change, so each earlier one is a past state of the same list. */
export function groupParts(parts: readonly unknown[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let lastPlan = -1;
  parts.forEach((part, i) => {
    if (typeOf(part) === "plan") lastPlan = i;
  });
  for (const [i, part] of parts.entries()) {
    if (typeOf(part) === "plan" && i !== lastPlan) continue;
    // Where one of the agent's own responses ends: metadata, nothing to show.
    // Taken for a block, it made every answer that closes with one (Claude,
    // Codex and pi close each response so) fold away as work.
    if (typeOf(part) === "assistant_response_boundary") continue;
    const text = textOf(part);
    if (text !== null) {
      if (text.trim()) items.push({ kind: "text", text });
      continue;
    }
    if (isActivity(part)) {
      const last = items[items.length - 1];
      const block = record(part) as Record<string, unknown>;
      if (last?.kind === "work") last.blocks.push(block);
      else items.push({ kind: "work", blocks: [block] });
      continue;
    }
    items.push({ kind: "block", block: part });
  }
  return items;
}

/** Splits a settled turn into the work that led to the answer and the answer
 *  itself: the text after the last block. A turn with no blocks is all answer. */
export function splitAnswer(items: readonly TimelineItem[]): {
  work: TimelineItem[];
  answer: TimelineItem[];
} {
  let cut = items.length;
  while (cut > 0 && items[cut - 1].kind === "text") cut -= 1;
  return { work: items.slice(0, cut), answer: items.slice(cut) };
}

/** Whether an activity block failed (a non-zero exit, an error status, a tool error, a failed subagent). */
export function activityFailed(block: Record<string, unknown>): boolean {
  if (block.status === "error" || block.isError === true) return true;
  if (record(block.state)?.status === "error") return true;
  return typeof block.exitCode === "number" && block.exitCode !== 0;
}

/** Whether an activity block is still running. */
export function activityRunning(block: Record<string, unknown>): boolean {
  if (block.status === "running" || block.status === "in_progress") return true;
  const state = record(block.state);
  return state?.status === "running" || state?.status === "in_progress";
}

/** What a run of activity amounts to, for its settled header ("Ran 3 commands · 2 edits"). */
export function summarizeWork(blocks: readonly Record<string, unknown>[]): WorkSummary {
  const summary: WorkSummary = { commands: 0, edits: 0, tools: 0, agents: 0, failed: 0 };
  for (const block of blocks) {
    switch (block.type) {
      case "command_execution":
        summary.commands += 1;
        break;
      case "diff":
        summary.edits += 1;
        break;
      case "tool":
        summary.tools += 1;
        break;
      case "subagent":
        summary.agents += 1;
        break;
    }
    if (activityFailed(block)) summary.failed += 1;
  }
  return summary;
}

/** The files a turn changed, once each, in first-touched order, with their line counts summed. */
export function changedFiles(parts: readonly unknown[]): ChangedFile[] {
  const byName = new Map<string, ChangedFile>();
  for (const part of parts) {
    const block = record(part);
    if (!block || block.type !== "diff" || typeof block.filename !== "string" || !block.filename) {
      continue;
    }
    const additions = typeof block.additions === "number" ? block.additions : 0;
    const deletions = typeof block.deletions === "number" ? block.deletions : 0;
    const known = byName.get(block.filename);
    if (known) {
      known.additions += additions;
      known.deletions += deletions;
    } else {
      byName.set(block.filename, { filename: block.filename, additions, deletions });
    }
  }
  return [...byName.values()];
}

/** The id of an approval (`approvalId`) or a question (`questionId`) block,
 *  whose payload may sit flat or nested under `request`; `""` for any other block. */
export function requestIdOf(block: unknown): string {
  const b = record(block);
  if (!b) return "";
  const req = record(b.request) ?? b;
  const id = b.type === "approval" ? req.approvalId : b.type === "question" ? req.questionId : undefined;
  return typeof id === "string" ? id : "";
}

/** A duration as the chat shows it: `45s`, `1m 3s`, `2h 5m`. Never negative. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${total % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
