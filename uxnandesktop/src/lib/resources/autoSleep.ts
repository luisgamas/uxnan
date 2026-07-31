// Workspace auto-sleep planner — pure TS, no Svelte imports, no timers.
//
// Decides, from a snapshot of the workspace world, which inactive workspaces
// the auto-sleep engine should act on and how. The engine
// (`state/autoSleep.svelte.ts`) gathers the snapshot on a slow tick and
// executes the plan; keeping the decision pure is what makes the guards
// testable under a fake clock.
//
// The guards are the feature's contract, not niceties:
//
// - **Everything is double-gated**: the profile's capability level AND the
//   explicit feature flag must both allow it, so the flag alone can kill the
//   whole behavior on rollback.
// - **A workspace with a working agent is NEVER slept automatically.** It gets
//   a *suggestion* at most (the notice the user acts on), even at level
//   `auto` — sleeping kills processes, and a mid-turn agent needs an explicit
//   OK, same as the manual path.
// - **Only evidence counts as idleness.** No last-active stamp → no action;
//   guessing recency is how work gets lost.
// - **The active workspace and the Global scratch space are untouchable**, as
//   is anything already asleep or holding no terminals.

import type { WorkspaceAutoSleepLevel } from "./policy";

/** One workspace as the engine snapshots it. */
export interface AutoSleepCandidate {
  /** Workspace key (a worktree path, or "" for Global). */
  key: string;
  /** Live (not asleep) terminal tabs in the workspace. */
  liveTerminals: number;
  /** Whether every terminal tab is already asleep. */
  asleep: boolean;
  /** Agent tabs currently working (the sleep blockers). */
  blockers: number;
  /** When the workspace was last active (epoch ms), or `null` if unknown. */
  lastActiveMs: number | null;
}

export interface AutoSleepDecision {
  key: string;
  /** `sleep` = put it to sleep now (level `auto`, no blockers);
   *  `suggest` = surface a suggestion the user confirms. */
  action: "sleep" | "suggest";
}

/** How long after prompting about a workspace we stay quiet about it, so a
 *  dismissed suggestion doesn't nag every tick. */
export const SUGGEST_COOLDOWN_MS = 30 * 60 * 1000;

export interface AutoSleepInput {
  /** The resolved capability level (from the policy). */
  level: WorkspaceAutoSleepLevel;
  /** The explicit feature flag (Settings → Resources → Resource mode). */
  flagEnabled: boolean;
  /** The currently active workspace key (never acted on). */
  activeKey: string;
  /** The Global scratch workspace key (never acted on). */
  globalKey: string;
  nowMs: number;
  /** Inactivity threshold from the policy. */
  idleMinutes: number;
  candidates: AutoSleepCandidate[];
  /** Per-workspace timestamp of the last suggestion shown (epoch ms). */
  lastPromptMs: Record<string, number>;
  /** Override the suggestion cooldown (tests). */
  promptCooldownMs?: number;
}

/** Compute what to do this tick. Deterministic; never mutates its input. */
export function planAutoSleep(input: AutoSleepInput): AutoSleepDecision[] {
  if (!input.flagEnabled || input.level === "off") return [];
  const cooldown = input.promptCooldownMs ?? SUGGEST_COOLDOWN_MS;
  const idleMs = input.idleMinutes * 60_000;
  const out: AutoSleepDecision[] = [];

  for (const c of input.candidates) {
    if (c.key === input.activeKey || c.key === input.globalKey) continue;
    if (c.asleep || c.liveTerminals === 0) continue;
    if (c.lastActiveMs === null) continue; // unknown recency: never guess
    if (input.nowMs - c.lastActiveMs < idleMs) continue;

    // A working agent downgrades even `auto` to a suggestion — the notice the
    // user confirms — and suggestions respect the per-workspace cooldown.
    const mustAsk = input.level === "suggest" || c.blockers > 0;
    if (mustAsk) {
      const last = input.lastPromptMs[c.key];
      if (last !== undefined && input.nowMs - last < cooldown) continue;
      out.push({ key: c.key, action: "suggest" });
    } else {
      out.push({ key: c.key, action: "sleep" });
    }
  }
  return out;
}
