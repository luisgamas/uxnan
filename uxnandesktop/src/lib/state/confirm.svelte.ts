// Save / Discard / Cancel prompt service (Svelte 5 runes).
//
// A store-driven 3-way confirm so non-component code (the terminals store's
// tab-close path) can ask the user what to do with unsaved file edits. A single
// `<SaveDiscardDialog>` is mounted in `+page.svelte` and renders this state;
// `request()` returns a promise that resolves with the user's choice. Mirrors
// how the toast service is a global hook over a mounted component.

export type SaveChoice = "save" | "discard" | "cancel";

interface SaveDiscardOptions {
  title: string;
  description?: string;
  saveLabel: string;
  discardLabel: string;
}

class SaveDiscardService {
  open = $state(false);
  title = $state("");
  description = $state("");
  saveLabel = $state("");
  discardLabel = $state("");
  private resolver: ((choice: SaveChoice) => void) | null = null;

  /** Open the dialog and resolve with the user's choice. A second request while
   *  one is open cancels the first (defensive; the UI is modal so it shouldn't
   *  happen). */
  request(opts: SaveDiscardOptions): Promise<SaveChoice> {
    this.resolver?.("cancel");
    this.title = opts.title;
    this.description = opts.description ?? "";
    this.saveLabel = opts.saveLabel;
    this.discardLabel = opts.discardLabel;
    this.open = true;
    return new Promise<SaveChoice>((resolve) => {
      this.resolver = resolve;
    });
  }

  /** Resolve the pending request (called by the dialog buttons; closing the
   *  dialog any other way resolves to "cancel"). */
  choose(choice: SaveChoice): void {
    this.open = false;
    const resolve = this.resolver;
    this.resolver = null;
    resolve?.(choice);
  }
}

/** Singleton save/discard/cancel prompt, driven by `<SaveDiscardDialog>`. */
export const saveDiscard = new SaveDiscardService();
