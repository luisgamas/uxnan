// Terminal-title (OSC) → agent state mapping — Layer 2 of agent monitoring
// (spec 02d §1.3). A fallback for agents that don't report via the hook server:
// many CLI agents update the terminal title (OSC 0/2 escape sequences, surfaced
// by xterm's `onTitleChange`) to reflect what they're doing ("thinking…",
// "waiting for input", "done"). We map recognizable titles to one of the four
// states; unknown titles (a plain `cwd` or `user@host`) map to null (ignored).
//
// Best-effort and heuristic — the hook server (Layer 1) is authoritative when an
// agent supports it; this only fills the gap for agents that don't.

import type { AgentStatus } from "$lib/types";

/** Ordered patterns; first match wins. Tested (case-insensitive) against the
 *  terminal title. Order matters: a title mentioning several cues resolves to
 *  the earliest-listed (most attention-worthy) state. */
const PATTERNS: [RegExp, AgentStatus][] = [
  [/\b(error|failed|failure|blocked|stuck|denied)\b/, "blocked"],
  [
    /\b(waiting|awaiting|input|your turn|approval|permission|confirm|confirmation|review|approve)\b/,
    "waiting",
  ],
  [
    /\b(working|thinking|running|generating|processing|executing|busy|compiling|building|analyzing|analysing|searching|reading|writing|editing)\b|\.\.\.|…/,
    "working",
  ],
  [/\b(done|complete|completed|finished|success|succeeded)\b|[✓✔]/, "done"],
];

/** Map a terminal title to an agent state, or null when nothing is recognized. */
export function statusFromTitle(title: string): AgentStatus | null {
  const t = title.toLowerCase();
  for (const [re, status] of PATTERNS) if (re.test(t)) return status;
  return null;
}
