// Insert file/folder paths into a running terminal by writing them to its PTY —
// the terminal's side of a drop (`$lib/fileDrop` decides where a drop goes).
// Paths are typed at the cursor with NO trailing newline, so nothing is executed.
import { invoke } from "@tauri-apps/api/core";
import { terminals } from "$lib/state/terminals.svelte";

/** Wrap a path in double quotes when it contains whitespace (left bare otherwise),
 *  so a path with spaces reaches the shell as a single argument. */
export function quoteDropPath(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

/** The PTY payload for a set of dropped paths: each shell-quoted, space-joined,
 *  with a trailing space so the shell separates it from the next token. */
export function dropPayload(paths: string[]): string {
  return paths.map(quoteDropPath).join(" ") + " ";
}

/** The pty id of the terminal pane under a viewport point, or null when the point
 *  isn't over a terminal. Panes carry `data-pty-id` (see `TerminalArea.svelte`). */
export function terminalPtyAt(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  const pane = el?.closest("[data-pty-id]") as HTMLElement | null;
  return pane?.dataset.ptyId ?? null;
}

/** Type [paths] at the cursor of terminal [ptyId] (never run: no newline),
 *  then hand it the focus so the user keeps typing there. Where paths are
 *  routed from — an OS drop or the file tree's drag — is `$lib/fileDrop`. */
export function writePathsToTerminal(ptyId: string, paths: string[]): void {
  void invoke("pty_write", { id: ptyId, data: dropPayload(paths) }).catch(() => {});
  terminals.controller(ptyId)?.focus(); // keep the cursor in the terminal
}
