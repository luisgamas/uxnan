// Which animation a pet plays, derived from what the agents are actually doing.
//
// The ADE already knows precise per-agent state (the Layer 1 hook server —
// `state/agentStatus.svelte.ts`), and that enum maps one-to-one onto the states
// the pet ecosystem animates:
//
//   working → running   blocked → failed
//   waiting → waiting   done    → review
//
// In global mode several agents can be reporting at once, so one has to win.
// The priority is the ecosystem's: whatever needs the human first.
//
// Pure module (no Tauri, no DOM) so it is unit-testable on its own.

import type { AgentStatus } from "$lib/types";

/** The states a pet can display — the four agent states plus resting. */
export type PetState = AgentStatus | "idle";

/** Animation name for each state, using the ecosystem's vocabulary. */
const ANIMATION: Record<PetState, string> = {
  working: "running",
  waiting: "waiting",
  done: "review",
  blocked: "failed",
  idle: "idle",
};

/**
 * Priority when several agents report at once: something that needs you beats
 * something that failed, which beats a finished result, which beats work still
 * in flight. Lower number wins.
 */
const PRIORITY: Record<PetState, number> = {
  waiting: 0,
  blocked: 1,
  done: 2,
  working: 3,
  idle: 4,
};

/**
 * How long a reported state is worth *showing*, measured from when the agent
 * entered it — not from the last time it was refreshed.
 *
 * A pet is not a status mirror. Mirroring `working` literally means a pet that
 * runs without pause for as long as a task takes, which reads as a spinner and
 * drowns out the states that actually need a human. Codex solves this by making
 * pet states **notifications that expire** (`RUNNING_LIFETIME = 3 min`), falling
 * back to idle while the work continues; the same idea is used here.
 *
 * The asymmetry is the point: "busy" is not actionable, so it fades quickly,
 * while anything waiting on the user persists — matching the app's own rule that
 * an attention state goes neutral once it has gone stale (spec `02d` §1.5).
 */
export const STATE_LIFETIME_MS: Record<PetState, number> = {
  working: 3 * 60_000,
  waiting: 30 * 60_000,
  blocked: 30 * 60_000,
  done: 30 * 60_000,
  idle: Number.POSITIVE_INFINITY,
};

/**
 * Whether a state entered at `since` has outlived its usefulness by `now`, and
 * the pet should drop back to resting.
 */
export function hasDecayed(state: PetState, since: number, now: number): boolean {
  const lifetime = STATE_LIFETIME_MS[state] ?? Number.POSITIVE_INFINITY;
  return now - since >= lifetime;
}

/** The animation name for a state (what the renderer asks the pet for). */
export function animationFor(state: PetState): string {
  return ANIMATION[state] ?? ANIMATION.idle;
}

/**
 * Collapse many agent states into the single one a global pet should show.
 * An empty list — nothing running — rests at `idle`.
 */
export function aggregateState(states: readonly PetState[]): PetState {
  let best: PetState = "idle";
  for (const s of states) {
    if (PRIORITY[s] < PRIORITY[best]) best = s;
  }
  return best;
}
