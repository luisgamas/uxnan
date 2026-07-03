// Drives a single PINNED sonner toast for the in-app updater — the replacement
// for the old fixed top-of-page UpdateBanner. The toast body (UpdateToast.svelte)
// reads the `updater` store reactively, so it re-renders itself as
// `status`/`progress` change; this driver only decides *whether* the pinned toast
// is on screen, mirroring the store's `bannerVisible` getter.
//
// The toast is pinned: a stable id + `duration: Infinity` (never auto-dismisses)
// + `dismissible: false` (a swipe/close can't kill it — only `updater.dismiss()`
// hides it, via `bannerVisible` flipping false). Because the effect re-runs on
// mount, a staged download restored on reload re-shows the toast automatically.

import { toast } from "$lib/toast";
import { updater } from "$lib/state/updater.svelte";
import UpdateToast from "$lib/components/UpdateToast.svelte";

/** Stable id so the pinned toast is a single, updatable surface. */
const TOAST_ID = "app-update";

/**
 * Show/hide the pinned update toast from the `updater` store. Call once from a
 * component's `$effect` (it establishes a reactive dependency on
 * `updater.bannerVisible`). Returns nothing; the effect's own teardown handles
 * re-runs.
 */
export function initUpdateToast(): void {
  $effect(() => {
    if (updater.bannerVisible) {
      // Idempotent: re-calling with the same id updates the existing toast
      // rather than stacking a new one.
      toast.custom(UpdateToast, {
        id: TOAST_ID,
        duration: Number.POSITIVE_INFINITY,
        dismissible: false,
      });
    } else {
      toast.dismiss(TOAST_ID);
    }
  });
}
