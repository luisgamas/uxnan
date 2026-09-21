// Display helpers for the orchestration run UI — map a run/step status to an
// i18n label key and a small dot color class. Kept out of the pure `run.ts`
// (which must stay free of app/i18n coupling); this is a frontend-only view util.

import CircleCheckIcon from "@hugeicons/core-free-icons/CircleCheckIcon";
import CircleXIcon from "@hugeicons/core-free-icons/CircleXIcon";
import HelpCircleIcon from "@hugeicons/core-free-icons/HelpCircleIcon";
import CircleDotIcon from "@hugeicons/core-free-icons/CircleDotIcon";
import type { IconNode } from "$lib/components/ui/icon";
import type { MessageKey } from "$lib/i18n/locales/en";
import type { InboxItemType, RunStatus, StepStatus } from "./run";

/** i18n key for a step status chip. */
export function stepStatusLabelKey(s: StepStatus): MessageKey {
  switch (s) {
    case "pending":
      return "orchestration.stepPending";
    case "ready":
      return "orchestration.stepReady";
    case "running":
      return "orchestration.stepRunning";
    case "blocked":
      return "orchestration.stepBlocked";
    case "completed":
      return "orchestration.stepCompleted";
    case "failed":
      return "orchestration.stepFailed";
    case "skipped":
      return "orchestration.stepSkipped";
  }
}

/** Dot fill for a step status (Tailwind bg-* class). */
export function stepStatusDot(s: StepStatus): string {
  switch (s) {
    case "running":
      return "bg-primary";
    case "ready":
      return "bg-sky-500";
    case "blocked":
      return "bg-amber-500";
    case "completed":
      return "bg-emerald-500";
    case "failed":
      return "bg-destructive";
    case "skipped":
      return "bg-muted-foreground/40";
    case "pending":
    default:
      return "bg-muted-foreground/50";
  }
}

/** i18n key for a run status chip. */
export function runStatusLabelKey(s: RunStatus): MessageKey {
  switch (s) {
    case "draft":
      return "orchestration.statusDraft";
    case "running":
      return "orchestration.statusRunning";
    case "paused":
      return "orchestration.statusPaused";
    case "completed":
      return "orchestration.statusCompleted";
    case "failed":
      return "orchestration.statusFailed";
    case "cancelled":
      return "orchestration.statusCancelled";
  }
}

/** Dot fill for a run status (Tailwind bg-* class). */
export function runStatusDot(s: RunStatus): string {
  switch (s) {
    case "running":
      return "bg-primary";
    case "paused":
      return "bg-amber-500";
    case "completed":
      return "bg-emerald-500";
    case "failed":
      return "bg-destructive";
    case "cancelled":
      return "bg-muted-foreground/40";
    case "draft":
    default:
      return "bg-muted-foreground/50";
  }
}

/** i18n key for the kind of a driven run's inbox message. */
export function inboxItemLabelKey(t: InboxItemType): MessageKey {
  switch (t) {
    case "worker_done":
      return "orchestration.inboxWorkerDone";
    case "worker_failed":
      return "orchestration.inboxWorkerFailed";
    case "question":
      return "orchestration.inboxQuestion";
    case "status":
      return "orchestration.inboxStatus";
  }
}

/** Glyph for an inbox message kind — the mark of the state it reports. */
export function inboxItemIcon(t: InboxItemType): IconNode {
  switch (t) {
    case "worker_done":
      return CircleCheckIcon;
    case "worker_failed":
      return CircleXIcon;
    case "question":
      return HelpCircleIcon;
    case "status":
      return CircleDotIcon;
  }
}

/** Text color for an inbox message kind's glyph — the step dots' palette. */
export function inboxItemTone(t: InboxItemType): string {
  switch (t) {
    case "worker_done":
      return "text-emerald-500";
    case "worker_failed":
      return "text-destructive";
    case "question":
      return "text-amber-500";
    case "status":
      return "text-muted-foreground";
  }
}
