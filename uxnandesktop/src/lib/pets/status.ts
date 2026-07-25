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

/**
 * Whether a state is one the user should act on. The pet uses this to decide
 * whether it may draw attention to itself (a subtle pulse) rather than just
 * animating quietly in the corner.
 */
export function wantsAttention(state: PetState): boolean {
  return state === "waiting" || state === "blocked" || state === "done";
}
