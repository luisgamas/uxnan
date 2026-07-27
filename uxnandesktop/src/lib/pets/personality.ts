// Idle personality — the difference between a status icon and a companion.
//
// The state→animation map (`status.ts`) is a straight 1:1: five states, five
// animations. Played literally that leaves a pet that only ever stands still or
// runs, while a pack like the bundled one ships eleven animations — most of them
// never seen. Worse, a pet that holds one loop forever reads as a spinner, not
// as something alive.
//
// So on top of the state's base animation, the pet occasionally plays a short
// one-shot "flavour": it looks around while resting, waves when it has been
// waiting on you, changes direction while running. The state still decides what
// the pet *means*; flavour only decides how it idles between those moments.
//
// Pure module (no timers, no DOM, no randomness of its own — the caller passes
// `random`) so the schedule is deterministic under test.

/** A scheduled one-shot: play `animation` for `holdMs`, `delayMs` from now. */
export interface FlavourPlan {
  animation: string;
  /** How long the flavour plays before the base animation resumes. */
  holdMs: number;
  /** How long to wait before starting it. */
  delayMs: number;
}

// Flavours used to be stretched here so decoration wouldn't twitch beside the
// slow idle. That stretch turned out to be right for *everything*, so it now
// lives in the animation set itself (`STATE_PACE` in `manifest.ts`) and a
// flavour plays exactly as the same row would when a state fires it — tune the
// pace there and every gesture follows.

interface FlavourSpec {
  /** Candidates, chosen uniformly. A pack missing one falls back (see
   *  `resolveAnimation`), so an incomplete pack degrades instead of breaking. */
  pick: readonly string[];
  /** Random wait before the flavour, in ms: `[min, max]`. */
  delay: readonly [number, number];
  holdMs: number;
}

/**
 * Flavours per base animation (which is 1:1 with the agent state).
 *
 * **A flavour costs more than it looks.** Ending one hands the renderer a
 * different animation again — the base — which restarts it from frame zero, so
 * the state replays its whole row three times as well. That is a feature: it is
 * what re-shows a live state that had long since settled into its idle tail,
 * without any of the machinery a "pulse" would need. But it means each entry
 * below schedules **two** bursts of movement, one of them several seconds long,
 * and the delay is really the pet's whole rest between them.
 *
 * So a flavour is always a *different* row than the state's own. Picking the
 * state's own row was tried and reverted: it stacks the one-shot on top of the
 * replay it already causes, and a `done` pet — a state that lasts half an hour —
 * spent that half hour celebrating.
 *
 * Frequency carries meaning, and it is set against how long the state lasts. A
 * pet that needs you nags every few seconds because that is the point. A resting
 * one stirs every half-minute. The long-lived states (busy while an agent keeps
 * reporting, ready and blocked for up to 30 minutes) are the calmest of all: at a
 * livelier cadence they read as a pet that never settles.
 */
const FLAVOURS: Record<string, FlavourSpec> = {
  // Resting: the "is it alive?" case. Look around, stretch, get bored.
  // `bounce` is an alias of `jumping` (both are row 4), so listing it too would
  // only make the hop twice as likely as the wave.
  idle: { pick: ["waving", "jumping"], delay: [14_000, 34_000], holdMs: 2_400 },
  // Needs you: wave to get attention, often enough to notice, not so often it
  // becomes wallpaper. The one state where insisting is the whole point.
  waiting: { pick: ["waving"], delay: [6_000, 13_000], holdMs: 2_400 },
  // Busy: a brief breather. It lasts as long as the agent keeps reporting, so the
  // rest between them is long — every half-minute or so the pet takes a breath
  // and then runs through the working row again, which is "still on it" without
  // miming the task like a spinner.
  running: { pick: ["idle"], delay: [25_000, 50_000], holdMs: 2_400 },
  // Ready: a pleased little hop — rarely. `done` sticks for up to half an hour,
  // and a livelier cadence is a pet that celebrates for the whole thirty minutes.
  review: { pick: ["bounce", "jumping"], delay: [25_000, 50_000], holdMs: 2_200 },
  // Blocked: sag now and then, so the failure keeps reading as a failure.
  // (`sad` is row 5, the same row as `failed` — a different entry, so it restarts
  // the way any other flavour does.) Long-lived too, hence unhurried.
  failed: { pick: ["sad"], delay: [20_000, 40_000], holdMs: 3_200 },
};

/**
 * Plan the next flavour for a base animation, or `null` when that state has
 * none (the pet then simply holds its base loop).
 *
 * `random` must return `[0, 1)`; the caller owns it so tests can pin the choice.
 */
export function planFlavour(base: string, random: () => number = Math.random): FlavourPlan | null {
  const spec = FLAVOURS[base];
  if (!spec || spec.pick.length === 0) return null;
  const [min, max] = spec.delay;
  const r = Math.min(0.999999, Math.max(0, random()));
  const pickIndex = Math.min(spec.pick.length - 1, Math.floor(random() * spec.pick.length));
  return {
    animation: spec.pick[pickIndex],
    holdMs: spec.holdMs,
    delayMs: Math.round(min + r * (max - min)),
  };
}

/** Whether a base animation has any flavour at all (useful for tests/UI). */
export function hasFlavour(base: string): boolean {
  return (FLAVOURS[base]?.pick.length ?? 0) > 0;
}
