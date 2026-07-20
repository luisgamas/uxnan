/**
 * Recovery + prevention for the bits-ui "orphaned body pointer-lock".
 *
 * bits-ui sets `document.body.style.pointerEvents = "none"` while any modal layer
 * (Dialog, AlertDialog, DropdownMenu, ContextMenu, Select) is open and restores
 * the body style when the last lock is destroyed. If a layer is torn down without
 * its cleanup running — or the restore snapshot itself captured the lock — the
 * inline lock survives with no owner: every pointer event then dies at `<body>`
 * while keyboard events (dispatched to the focused element regardless of
 * hit-testing) keep flowing, and only killing the process recovers. The classic
 * trigger is opening a dialog from a dropdown-menu item, where the two layers'
 * body-style bookkeeping races (radix-ui/primitives#1241/#3645/#3317,
 * shadcn-ui/ui#2214/#5586/#7929).
 *
 * Two defenses live here: `deferModalOpen` (prevention — let a menu fully close
 * before its dialog opens) and `installPointerLockGuard` (recovery — heal an
 * already-orphaned lock on the next click).
 */

/** True when the inline body pointer-events lock has no live owner and it is
 *  safe to release it. `hasOpenLayer` = any `[data-state="open"]` element in the
 *  document (bits-ui marks every open modal layer this way, so an open modal is
 *  the only legitimate reason for the body lock to be present). */
export function isOrphanedPointerLock(
  bodyInlinePointerEvents: string,
  hasOpenLayer: boolean,
): boolean {
  return bodyInlinePointerEvents === "none" && !hasOpenLayer;
}

/** Open a bits-ui modal (Dialog/AlertDialog) one macrotask after a menu item is
 *  clicked, so the closing DropdownMenu/ContextMenu fully releases its own body
 *  pointer-lock *before* the dialog snapshots the body style. Opening the dialog
 *  synchronously in the same gesture makes it capture `pointer-events: none` as
 *  its "initial" style and faithfully restore that on close — the classic
 *  dropdown→dialog orphaned-lock race. A 0 ms timeout is the ecosystem-standard
 *  defer; a nullish handler is a no-op (menu items are often conditionally
 *  present). */
export function deferModalOpen(open: (() => void) | undefined | null): void {
  if (!open) return;
  setTimeout(open, 0);
}

/**
 * Install a capture-phase `pointerdown` watchdog that heals an orphaned body
 * pointer-lock on the very first click of a freeze: the click that lands during a
 * freeze schedules a re-check and, if the lock is *still* orphaned 120 ms later
 * (long enough to outlive bits-ui's ~24 ms cleanup and any same-gesture modal
 * open), it clears the inline `pointer-events` so the next click lands normally.
 *
 * It never touches any other style property — bits-ui's own cleanup still owns
 * the full scroll-lock restore — and never acts while a modal is open, so the
 * idle cost is a two-property read per click and there is no interference with
 * normal use (it never calls `preventDefault`/`stopPropagation`). Returns an
 * uninstaller.
 */
export function installPointerLockGuard(
  win: Window = window,
  doc: Document = document,
): () => void {
  const onPointerDown = (): void => {
    const hasOpenLayer = doc.querySelector('[data-state="open"]') !== null;
    if (!isOrphanedPointerLock(doc.body.style.pointerEvents, hasOpenLayer)) {
      return;
    }
    // Re-check after the library's cleanup window + any same-gesture open so a
    // legitimately just-closing modal is never disturbed; only a lock that is
    // still orphaned then is a true leak.
    win.setTimeout(() => {
      const stillOrphaned = isOrphanedPointerLock(
        doc.body.style.pointerEvents,
        doc.querySelector('[data-state="open"]') !== null,
      );
      if (!stillOrphaned) return;
      doc.body.style.removeProperty("pointer-events");
      console.warn(
        "[pointer-lock-guard] released an orphaned body pointer-events lock",
      );
    }, 120);
  };
  win.addEventListener("pointerdown", onPointerDown, true);
  return () => win.removeEventListener("pointerdown", onPointerDown, true);
}
