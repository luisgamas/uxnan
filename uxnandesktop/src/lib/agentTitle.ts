// Terminal-title (OSC) → agent state mapping — Layer 2 of agent monitoring
// (spec 02d §1.3). A fallback for agents that don't report via the hook server:
// many CLI agents update the terminal title (OSC 0/2 escape sequences, surfaced
// by xterm's `onTitleChange`) to reflect what they're doing ("thinking…",
// "waiting for input", "done"). We map recognizable titles to one of the four
// states; unknown titles (a plain `cwd` or `user@host`) map to null (ignored).
//
// Best-effort and heuristic — the hook server (Layer 1) is authoritative when an
// agent supports it; this only fills the gap for agents that don't.
//
// The boundaries are deliberately stricter than `\b`: a bare `\b` still matches a
// keyword sitting inside a path (`~/codex/ready`, `C:\proj\working`,
// `codex.done`), because `/`, `\`, `.` and `-` are non-word characters, so `\b`
// falls between them and the keyword. We reject a keyword preceded by any of
// those path/word characters (left lookbehind) and followed by a word char or
// hyphen (right lookahead), so `already ⊃ ready`, `reworking ⊃ working`,
// `overthinking ⊃ thinking` and `~/x/done` don't mint a false status, while real
// sentence titles ("Codex done.", "Waiting for input") still match.

import type { AgentStatus } from "$lib/types";

/** Rejects a keyword that is part of a path segment or a longer word. */
const L = "(?<![\\w./\\\\-])"; // left: not preceded by a path/word char
const R = "(?![\\w-])"; // right: not followed by a word char or hyphen

function kw(words: string): RegExp {
  return new RegExp(`${L}(?:${words})${R}`, "i");
}

/** Ordered patterns; first match wins. Order matters: a title mentioning several
 *  cues resolves to the earliest-listed (most attention-worthy) state. */
const PATTERNS: [RegExp, AgentStatus][] = [
  [kw("error|failed|failure|blocked|stuck|denied"), "blocked"],
  [
    kw(
      "waiting|awaiting|input|approval|permission|confirm|confirmation|review|approve",
    ),
    "waiting",
  ],
  // "working"-ish: keyword set OR a trailing ellipsis (a common "busy" marker).
  [
    new RegExp(
      `${L}(?:working|thinking|running|generating|processing|executing|busy|compiling|building|analyzing|analysing|searching|reading|writing|editing)${R}|\\.\\.\\.|…`,
      "i",
    ),
    "working",
  ],
  [
    new RegExp(`${L}(?:done|complete|completed|finished|success|succeeded)${R}|[✓✔]`, "i"),
    "done",
  ],
];

/** Map a terminal title to an agent state, or null when nothing is recognized. */
export function statusFromTitle(title: string): AgentStatus | null {
  for (const [re, status] of PATTERNS) if (re.test(title)) return status;
  return null;
}
