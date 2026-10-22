// How one turn of a chat is laid out: the agent's answer arrives as an ordered
// list of text runs and structured blocks (`segments`), and the timeline reads
// better grouped than flat —
//
//  - consecutive activity (commands, edits, tool calls, thoughts) becomes one work
//    group, open while the turn runs and summarized once it settles; a
//    subagent is not a step of the log but its own card between them;
//  - a page from the bridge carries a settled run of steps as ONE `work`
//    summary (`WorkRunSegment`, shared/src/models/history.ts: its stored index
//    range, counts and changed files), and a live turn streams each step as a
//    bounded preview; both are parts of the same group, so a run that began
//    before the page was read and goes on live reads as one;
//  - a settled turn folds everything before its closing answer behind one
//    "Worked for 1m 3s" line, so a long session reads as its conclusions;
//  - the files a turn changed are gathered into one card at its end.
//
// Pure: every input crossed a process boundary (the bridge), so each field is
// read defensively and an unknown shape is passed through as a lone block.

import {
  isStep,
  isWorkRunSegment,
  stepFailed,
  stepRunning,
  type ChangedFileSummary,
  type WorkRunSegment,
} from "$shared/models/history";

/** One part of a work group: a settled run the page summarized, or one step
 *  (a live preview, or a step of a run `turn/steps` served). */
export type WorkPart = WorkRunSegment | Record<string, unknown>;

export type TimelineItem =
  /** [opens]: the first text of one of the agent's own responses after an
   *  earlier one ended (an `assistant_response_boundary` came before it). */
  | { kind: "text"; text: string; opens?: boolean }
  | { kind: "work"; parts: WorkPart[] }
  | { kind: "block"; block: unknown };

export interface WorkSummary {
  /** How many steps the group holds, summarized runs included. */
  steps: number;
  commands: number;
  edits: number;
  tools: number;
  /** Stretches of reasoning (`thinking` steps). */
  thoughts: number;
  failed: number;
  running: number;
}

export type ChangedFile = ChangedFileSummary;

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

/** Whether a part is the agent's work: one step (a command, an edit, a tool
 *  call) or a page's summary of a run of them. */
export function isActivity(part: unknown): boolean {
  return isStep(part) || isWorkRunSegment(part);
}

/** How many steps a run summarizes. */
export function runSize(run: WorkRunSegment): number {
  return run.commands + run.edits + run.tools + run.thoughts;
}

/** The step a group's last part ends on: the part itself, or a run's `last`. */
export function lastStepOf(part: unknown): Record<string, unknown> | undefined {
  if (isWorkRunSegment(part)) return part.last as unknown as Record<string, unknown>;
  return isStep(part) ? part : undefined;
}

/**
 * A thought's text on one line, as its collapsed row reads it: Markdown marks
 * dropped (headings, emphasis, code fences and ticks, quotes, list bullets,
 * link targets), whitespace collapsed. The row truncates it to its width.
 */
export function plainLine(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n?/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|\*|~~|`)(?=\S)([^]*?\S)\1/g, "$2")
    .replace(/(^|\W)(__|_)(?=\S)([^]*?\S)\2(?=\W|$)/g, "$1$3")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Groups a turn's parts: runs of activity become one `work` item; blank text
 *  and the zero-text response boundaries disappear — a boundary only marks the
 *  text after it as opening a new response (`opens`); and of the plans the turn
 *  carries, only the latest stays — an agent resends its whole to-do list on
 *  every change, so each earlier one is a past state of the same list. */
export function groupParts(parts: readonly unknown[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let lastPlan = -1;
  parts.forEach((part, i) => {
    if (typeOf(part) === "plan") lastPlan = i;
  });
  let ended = false;
  for (const [i, part] of parts.entries()) {
    if (typeOf(part) === "plan" && i !== lastPlan) continue;
    // Where one of the agent's own responses ends: metadata, nothing to show.
    // Taken for a block, it made every answer that closes with one (Claude,
    // Codex and pi close each response so) fold away as work.
    if (typeOf(part) === "assistant_response_boundary") {
      ended = items.length > 0;
      continue;
    }
    const text = textOf(part);
    if (text !== null) {
      if (text.trim()) {
        items.push(ended ? { kind: "text", text, opens: true } : { kind: "text", text });
        ended = false;
      }
      continue;
    }
    ended = false;
    if (isActivity(part)) {
      const last = items[items.length - 1];
      const block = record(part) as Record<string, unknown>;
      if (last?.kind === "work") last.parts.push(block);
      else items.push({ kind: "work", parts: [block] });
      continue;
    }
    items.push({ kind: "block", block: part });
  }
  return items;
}

/** A notice the bridge adds about the turn (`system`: a background task cut
 *  short, a limit reached) — said after the answer, never part of the work. */
function isNotice(item: TimelineItem): boolean {
  return item.kind === "block" && typeOf(item.block) === "system";
}

/** Splits a settled turn into the work that led to the answer and the answer
 *  itself: the text after the last block — or of the agent's last response,
 *  when it answered in several (Codex's commentary, then its final answer) —
 *  with any notices that follow it. A turn with no blocks, in one response, is
 *  all answer. A notice closing the turn used to count
 *  as its last block, which folded the whole answer away behind it.
 *
 *  A view the agent showed is part of the answer, never of the work: it is
 *  what the person asked to see, and folded behind "Worked for…" only someone
 *  who knew it was there would find it. Views leave the work, in the order the
 *  agent showed them, and open the answer. */
export function splitAnswer(items: readonly TimelineItem[]): {
  work: TimelineItem[];
  answer: TimelineItem[];
} {
  let cut = items.length;
  while (cut > 0 && (items[cut - 1].kind === "text" || isNotice(items[cut - 1]))) {
    cut -= 1;
    const item = items[cut];
    // The last response began here: what came before is the work toward it.
    if (item.kind === "text" && item.opens) break;
  }
  // Notices alone are not an answer: they stay where they are, after the work.
  if (!items.slice(cut).some((i) => i.kind === "text")) cut = items.length;
  const isView = (i: TimelineItem) => i.kind === "block" && typeOf(i.block) === "view";
  const work = items.slice(0, cut);
  return {
    work: work.filter((i) => !isView(i)),
    answer: [...work.filter(isView), ...items.slice(cut)],
  };
}

/** What a group of work amounts to, for its header ("Ran 3 commands · 2
 *  edits", how many failed): a summarized run brings its counts, a step
 *  counts itself — by the one rule every client uses (`stepFailed`,
 *  `stepRunning`). */
export function summarizeWork(parts: readonly WorkPart[]): WorkSummary {
  const summary: WorkSummary = { steps: 0, commands: 0, edits: 0, tools: 0, thoughts: 0, failed: 0, running: 0 };
  for (const part of parts) {
    if (isWorkRunSegment(part)) {
      summary.steps += runSize(part);
      summary.commands += part.commands;
      summary.edits += part.edits;
      summary.tools += part.tools;
      summary.thoughts += part.thoughts;
      summary.failed += part.failed;
      summary.running += part.running;
      continue;
    }
    switch (part.type) {
      case "command_execution":
        summary.commands += 1;
        break;
      case "diff":
        summary.edits += 1;
        break;
      case "tool":
        summary.tools += 1;
        break;
      case "thinking":
        summary.thoughts += 1;
        break;
    }
    summary.steps += 1;
    if (stepFailed(part)) summary.failed += 1;
    if (stepRunning(part)) summary.running += 1;
  }
  return summary;
}

/** The files a turn changed, once each, in first-touched order, with their
 *  line counts summed — from its edits, and from the `files` each summarized
 *  run reports for the edits it folds. */
export function changedFiles(parts: readonly unknown[]): ChangedFile[] {
  const byName = new Map<string, ChangedFile>();
  const add = (filename: unknown, additions: unknown, deletions: unknown) => {
    if (typeof filename !== "string" || !filename) return;
    const plus = typeof additions === "number" ? additions : 0;
    const minus = typeof deletions === "number" ? deletions : 0;
    const known = byName.get(filename);
    if (known) {
      known.additions += plus;
      known.deletions += minus;
    } else {
      byName.set(filename, { filename, additions: plus, deletions: minus });
    }
  };
  for (const part of parts) {
    if (isWorkRunSegment(part)) {
      for (const file of part.files) add(file?.filename, file?.additions, file?.deletions);
      continue;
    }
    const block = record(part);
    if (block?.type === "diff") add(block.filename, block.additions, block.deletions);
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
