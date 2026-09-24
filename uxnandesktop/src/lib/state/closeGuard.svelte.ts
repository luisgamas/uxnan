// Asks before the window closes over unfinished work — an agent mid-turn, a
// file with unsaved edits. Closing the window quits the app, whichever way it
// was asked for: its close button, Alt+F4, ⌘Q, Close Window (⌘⇧W). A store so
// the close path (`app.svelte.ts`) can ask; `<CloseGuardDialog>` in
// `+page.svelte` renders it, as the save/discard prompt does.

export interface UnfinishedWork {
  /** Agents in the middle of a turn. */
  working: number;
  /** Files with unsaved edits. */
  unsaved: number;
}

class CloseGuard {
  open = $state(false);
  work = $state<UnfinishedWork>({ working: 0, unsaved: 0 });
  private resolver: ((close: boolean) => void) | null = null;

  /** Whether closing would lose anything. */
  static matters(work: UnfinishedWork): boolean {
    return work.working > 0 || work.unsaved > 0;
  }

  /** Ask; resolves `true` to close anyway, `false` to stay. A second request
   *  while one is open answers the first "stay". */
  request(work: UnfinishedWork): Promise<boolean> {
    this.resolver?.(false);
    this.work = work;
    this.open = true;
    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
    });
  }

  /** The person's answer (the dialog closing any other way is "stay"). */
  choose(close: boolean): void {
    this.open = false;
    const resolve = this.resolver;
    this.resolver = null;
    resolve?.(close);
  }
}

export const closeGuard = new CloseGuard();
export const closeMatters = CloseGuard.matters;
