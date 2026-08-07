// Closing the whole "Ready to close" lane at once.
//
// This is the point of everything before it. One-at-a-time closing is fine at
// three finished spaces and pointless at thirty, and thirty is exactly what a
// cheap-to-create workspace produces. But a batch is also where a careless rule
// does the most damage, so this one is deliberately stricter than the single
// dialog:
//
//   **Anything with a warning is skipped, not closed.**
//
// In the single dialog, uncommitted work is a warning you may override — you are
// looking at one worktree and you know what is in it. In a batch you are looking
// at a count. So a space with uncommitted changes, unpushed commits or a live
// agent is *listed as skipped* and left alone; you close it yourself, one at a
// time, with the warning in front of you. The batch only ever does the part that
// is provably safe.

import { removalDefaults, type RemovalInputs } from "./worktree-removal";

export interface BatchCandidate<T> {
  item: T;
  inputs: RemovalInputs;
}

export interface BatchEntry<T> {
  item: T;
  /** Delete this one's local branch too (its commits landed). */
  deleteLocal: boolean;
}

export interface SkippedEntry<T> {
  item: T;
  /** The first reason it was left out — the one worth showing in a list. */
  reason: "uncommitted" | "unpushed" | "live-agents" | "not-finished";
}

export interface BatchClosePlan<T> {
  /** Safe to close now, in the order given. */
  close: BatchEntry<T>[];
  /** Left alone, with the reason, so the list never quietly shrinks. */
  skipped: SkippedEntry<T>[];
}

/**
 * Split the lane into what a batch may close and what it must not touch.
 *
 * Pure: "how many will this actually delete, and what does it leave behind" is a
 * unit test, not a discovery you make afterwards.
 */
export function planBatchClose<T>(candidates: readonly BatchCandidate<T>[]): BatchClosePlan<T> {
  const close: BatchEntry<T>[] = [];
  const skipped: SkippedEntry<T>[] = [];

  for (const { item, inputs } of candidates) {
    const defaults = removalDefaults(inputs);
    if (defaults.verdict === null) {
      // It stopped being finished between building the lane and confirming.
      skipped.push({ item, reason: "not-finished" });
      continue;
    }
    if (defaults.warnings.length > 0) {
      skipped.push({ item, reason: defaults.warnings[0] });
      continue;
    }
    close.push({ item, deleteLocal: defaults.deleteLocal });
  }

  return { close, skipped };
}
