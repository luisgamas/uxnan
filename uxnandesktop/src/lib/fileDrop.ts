// Paths dropped onto the app — files dragged in from Finder / Explorer (the
// OS drop) or a row dragged out of the file tree — and the one router that
// hands them to whatever is under the pointer.
//
// Tauri's native drag-drop owns the OS gesture: it suppresses HTML5 drops of
// files inside the WebView, so no component can take a `drop` event of its
// own. One listener for the window (`listenForOsDrops`, started by the app
// shell) hit-tests where the files land instead:
//   - an element marked with `use:fileDropTarget` (the chat composer) takes
//     them, and is told while files hover over it so it can say it will;
//   - a terminal pane (`data-pty-id`) gets the paths typed at its cursor;
//   - an OS drop that lands on neither goes to the active terminal (the
//     window-wide drop terminals have always taken); the file tree's drag has
//     to land on a target.

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { currentOS, type OS } from "$lib/platform";
import { terminals } from "$lib/state/terminals.svelte";
import { terminalPtyAt, writePathsToTerminal } from "$lib/terminal/terminalDrop";

/** What a drop target does with paths dropped on it. */
export interface FileDropTarget {
  ondrop: (paths: string[]) => void;
  /** Whether paths are being dragged over it right now. */
  onover?: (over: boolean) => void;
}

/** Where the paths come from: the OS falls back to the active terminal. */
export type DropSource = "os" | "tree";

const targets = new Map<HTMLElement, FileDropTarget>();
let hovered: HTMLElement | null = null;

/** Mark [node] as a place paths can be dropped (`use:fileDropTarget={…}`). */
export function fileDropTarget(node: HTMLElement, target: FileDropTarget) {
  node.dataset.fileDrop = "";
  targets.set(node, target);
  return {
    update(next: FileDropTarget) {
      targets.set(node, next);
    },
    destroy() {
      if (hovered === node) hovered = null;
      targets.delete(node);
      delete node.dataset.fileDrop;
    },
  };
}

function targetAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y);
  const node = el?.closest<HTMLElement>("[data-file-drop]") ?? null;
  return node && targets.has(node) ? node : null;
}

function setHovered(node: HTMLElement | null): void {
  if (node === hovered) return;
  if (hovered) targets.get(hovered)?.onover?.(false);
  hovered = node;
  if (node) targets.get(node)?.onover?.(true);
}

/** Paths are being dragged over the viewport point (x, y) in CSS px — or no
 *  longer over the window, when [point] is null. */
export function hoverPathsAt(point: { x: number; y: number } | null): void {
  setHovered(point ? targetAt(point.x, point.y) : null);
}

/** Deliver [paths] dropped at the viewport point (x, y) in CSS px. True when
 *  something took them. */
export function dropPathsAt(paths: string[], x: number, y: number, source: DropSource): boolean {
  setHovered(null);
  if (paths.length === 0) return false;
  const node = targetAt(x, y);
  if (node) {
    targets.get(node)!.ondrop(paths);
    return true;
  }
  const ptyId = terminalPtyAt(x, y) ?? (source === "os" ? terminals.activePtyId() : null);
  if (!ptyId) return false;
  writePathsToTerminal(ptyId, paths);
  return true;
}

/**
 * The position of an OS drag-drop event in CSS px, where the window is
 * hit-tested. The event types it as physical pixels, but what the webview
 * actually sends (wry 0.55, behind tauri 2.11 — re-check this when either is
 * upgraded) differs per platform: macOS reports the point in the view's own
 * coordinates (points, already CSS px) and Linux in the widget's (also CSS
 * px); only Windows maps the screen point to the client area in physical
 * pixels. Dividing everywhere halved the point on a Retina Mac, so drops
 * from the file manager never landed on the composer.
 */
export function dropPointToCss(
  p: { x: number; y: number },
  os: OS = currentOS(),
  dpr: number = window.devicePixelRatio || 1,
): { x: number; y: number } {
  return os === "windows" ? { x: p.x / dpr, y: p.y / dpr } : { x: p.x, y: p.y };
}

/** Listen for files dropped from the OS onto this window; returns the
 *  unlisten. Positions are brought to CSS px (`dropPointToCss`) and hit-tested
 *  there. */
export async function listenForOsDrops(): Promise<() => void> {
  return getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === "leave") {
      hoverPathsAt(null);
      return;
    }
    const point = dropPointToCss(payload.position);
    if (payload.type === "drop") dropPathsAt(payload.paths, point.x, point.y, "os");
    else hoverPathsAt(point);
  });
}
