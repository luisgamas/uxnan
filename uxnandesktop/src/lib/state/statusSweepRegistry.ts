// Status-sweep registry — pure TS, no Svelte imports (so Vitest can test it).
//
// "Something changed on disk, re-read every worktree's git badges" is requested
// from places that must not import the projects store: `projects` already
// imports `agentStatus`, so the agent listener importing `projects` back would
// close an import cycle. The store registers its sweep here at construction and
// the signal sites call `requestSweep()` — same shape as `flushRegistry`.

type Sweep = () => void;
let sweep: Sweep | null = null;

/** Register the sweep implementation (the projects store does this once). */
export function registerStatusSweep(fn: Sweep): void {
  sweep = fn;
}

/** Ask for a sweep. A no-op before the store registers one, or in a harness
 *  where the store was never constructed. */
export function requestSweep(): void {
  sweep?.();
}

/** Inputs to the "should I re-read every worktree now?" decision. */
export interface SweepDecision {
  /** A sweep is already running (they must not overlap: N git walks each). */
  inFlight: boolean;
  /** `true` for a signalled sweep (agent activity, window focus, our own git
   *  action) — those skip the interval, because the point is to be immediate. */
  force: boolean;
  /** Window hidden: the badges nobody is looking at can wait. */
  hidden: boolean;
  /** `Date.now()` at the call, and when the last sweep completed. */
  now: number;
  lastSweep: number;
  /** Minimum gap between unforced sweeps. */
  intervalMs: number;
}

/** Whether a status sweep should run. Pure so the pacing is testable without a
 *  store, a timer or a backend. */
export function shouldSweep(d: SweepDecision): boolean {
  if (d.inFlight) return false;
  if (d.force) return true;
  if (d.hidden) return false;
  return d.now - d.lastSweep >= d.intervalMs;
}
