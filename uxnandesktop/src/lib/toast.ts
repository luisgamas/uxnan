// Thin wrapper over svelte-sonner's toast — non-blocking, auto-expiring
// notifications for errors and successes (replaces the old inline error banners).
// The <Toaster/> is mounted once in `+page.svelte`.

import { toast } from "svelte-sonner";

export { toast };

/** Extract a human-readable message from a thrown value / CommandError. */
export function errorMessage(e: unknown): string {
  return e && typeof e === "object" && "message" in e
    ? String((e as { message: unknown }).message)
    : String(e);
}

/** Show an error toast for a thrown value. */
export function toastError(e: unknown): void {
  toast.error(errorMessage(e));
}
