// Anti-jump layer for the left sidebar's ordered lists.
//
// The "attention" and "recent" sort modes derive their keys from agent state and
// recency, which drift while you watch — recomputing the order on every tick would
// make cards visibly jump. `createStableOrder` freezes the rendered order and only
// applies a fresh computation:
//   • immediately, on a structural change (the *set* of items changed — add/remove)
//     or when the mode doesn't drift (manual / name), and
//   • after a short settle delay otherwise (attention / recent reshuffles),
// so a burst of state changes coalesces into one reorder once things quiet down.
//
// Call it once at the top level of a component's <script> (it registers `$effect`s).

import { untrack } from "svelte";

/** Whether two lists hold the same *set* of keys (membership, ignoring order). */
function sameMembership<T>(a: T[], b: T[], keyOf: (item: T) => string): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(a.map(keyOf));
  for (const item of b) if (!seen.has(keyOf(item))) return false;
  return true;
}

export interface StableOrderOptions<T> {
  /** Reactive: returns the freshly-sorted list (reads the sort mode + metadata). */
  compute: () => T[];
  /** Stable identity of an item, for membership comparison. */
  keyOf: (item: T) => string;
  /** Reactive: true when the current mode doesn't drift (manual / name) and so
   *  should apply instantly with no debounce. */
  immediate: () => boolean;
  /** Settle delay (ms) before applying a drift-only reshuffle. Default 2500. */
  settleMs?: number;
}

/** A frozen, jump-free view of a reactive ordered list. Read `.items` in markup. */
export interface StableOrder<T> {
  readonly items: T[];
}

export function createStableOrder<T>(
  opts: StableOrderOptions<T>,
): StableOrder<T> {
  const settleMs = opts.settleMs ?? 2500;
  let rendered = $state<T[]>(untrack(() => opts.compute()));
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  $effect(() => {
    const next = opts.compute(); // tracks the mode + item metadata
    const now = opts.immediate(); // tracks the mode
    // Read the current order without tracking it, so writing `rendered` below
    // doesn't re-trigger this effect.
    const structural = !untrack(() =>
      sameMembership(rendered, next, opts.keyOf),
    );
    if (now || structural) {
      clear();
      rendered = next;
    } else {
      clear();
      timer = setTimeout(() => {
        timer = null;
        rendered = next;
      }, settleMs);
    }
  });

  // Cancel a pending settle when the component unmounts.
  $effect(() => clear);

  return {
    get items() {
      return rendered;
    },
  };
}
