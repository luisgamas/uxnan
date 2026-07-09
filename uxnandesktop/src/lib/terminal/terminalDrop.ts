// Insert file/folder paths into a running terminal by writing them to its PTY.
// Shared by (a) the native OS file-drop (dragging a file in from Explorer/Finder)
// and (b) the file tree's in-app drag. Tauri suppresses HTML5 drag-and-drop inside
// the webview, so the in-app drag is pointer-based and resolves its target here.
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

/** Write `paths` into the terminal pane under (clientX, clientY), if the point is
 *  over one, then hand focus to that terminal so the user keeps typing there.
 *  Returns true when a terminal received them (so the caller can give feedback /
 *  fall back). Unlike the OS drop, the in-app drag deliberately has no
 *  active-terminal fallback — you must drop onto a terminal. */
export function dropPathsIntoTerminal(
  paths: string[],
  clientX: number,
  clientY: number,
): boolean {
  if (paths.length === 0) return false;
  const ptyId = terminalPtyAt(clientX, clientY);
  if (!ptyId) return false;
  void invoke("pty_write", { id: ptyId, data: dropPayload(paths) }).catch(() => {});
  terminals.controller(ptyId)?.focus(); // keep the cursor in the terminal
  return true;
}
