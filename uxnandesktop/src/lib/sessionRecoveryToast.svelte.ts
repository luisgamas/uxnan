// Drives the single "previous session ended unexpectedly" toast, mirroring the
// updater's pinned-toast driver: the body (SessionRecoveryToast.svelte) reads the
// `diagnostics` store reactively and this decides only *whether* it is on screen.
//
// It never auto-dismisses (a notice the user did not happen to be looking at is
// a notice that did not happen), but unlike the updater's it is dismissible: it
// is informational, it fires at most once per launch, and there is no action it
// is waiting for.

import { toast } from "$lib/toast";
import { diagnostics } from "$lib/state/diagnostics.svelte";
import SessionRecoveryToast from "$lib/components/SessionRecoveryToast.svelte";

/** Stable id so re-runs update one toast instead of stacking copies. */
const TOAST_ID = "session-recovery";

/**
 * Show/hide the session-recovery toast from the `diagnostics` store. Call once
 * from a component's `$effect`.
 */
export function initSessionRecoveryToast(): void {
  $effect(() => {
    if (diagnostics.noticeVisible) {
      toast.custom(SessionRecoveryToast, {
        id: TOAST_ID,
        duration: Number.POSITIVE_INFINITY,
        class: "uxnan-update-toast",
      });
    } else {
      toast.dismiss(TOAST_ID);
    }
  });
}
