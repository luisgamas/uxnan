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

/**
 * What to do with a report once its state has used up its lifetime.
 *
 * `rearm` is the case worth naming. A lifetime exists so the pet doesn't mime
 * `working` for a whole task like a spinner — but an agent that is *still
 * reporting* is still doing the thing, and dropping it leaves the pet resting on
 * top of live work and pointing nowhere (the click target goes with the state).
 * So a decayed state whose agent spoke within `rearmWithinMs` starts its
 * lifetime over; the *animation* is what keeps it from looking like a spinner,
 * by playing the row a few times and settling. An agent that has gone quiet —
 * finished, crashed, terminal closed — is simply dropped, as before.
 */
export function decayVerdict(
  state: PetState,
  since: number,
  lastUpdate: number,
  now: number,
  rearmWithinMs: number,
): "show" | "rearm" | "drop" {
  if (!hasDecayed(state, since, now)) return "show";
  return now - lastUpdate <= rearmWithinMs ? "rearm" : "drop";
}

/** The animation name for a state (what the renderer asks the pet for). */
export function animationFor(state: PetState): string {
  return ANIMATION[state] ?? ANIMATION.idle;
}

/**
 * The state a pet should show for one hook report.
 *
 * Almost always the reported state verbatim — with one correction. A turn the
 * user cut short (Esc / Ctrl-C, or the interrupt inference) is reported as
 * `done` **carrying an interrupt flag**, because for every other consumer the
 * turn did end. A pet answering that with the pleased "ready" gesture says the
 * opposite of what happened, so here — and only here — an interrupted `done`
 * reads as `blocked`.
 *
 * It is also what makes `blocked` reachable at all in practice: of the five
 * agents that report, only OpenCode can raise a genuine error state (its
 * `session.error` → `Error`), which left the sheet's failed row all but unused.
 */
export function petStateOf(report: { status: AgentStatus; interrupted?: boolean }): PetState {
  return report.status === "done" && report.interrupted === true ? "blocked" : report.status;
}

/**
 * Which report the pet is *about*, among those sharing the shown state: the one
 * that reported most recently.
 *
 * The pet shows one state, but that state can be true of several agents at once,
 * and it attaches to exactly one of them — the tooltip names its task and a
 * click reveals its terminal. Picking the first match instead (the order reports
 * happened to land in a map, which is roughly the order each agent first
 * reported since launch) made the pet point at an arbitrary one of the
 * candidates: neither the agent you are driving nor the one that just moved.
 * The freshest report is both meaningful and cheap — in practice it *is* the
 * agent you are working with, without pinning the pet to the selected worktree
 * (which would go quiet exactly when something elsewhere needs you).
 */
export function pickDriver<T extends { state: PetState; lastUpdate: number }>(
  reports: readonly T[],
  state: PetState,
): T | undefined {
  let best: T | undefined;
  for (const report of reports) {
    if (report.state !== state) continue;
    if (!best || report.lastUpdate > best.lastUpdate) best = report;
  }
  return best;
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
