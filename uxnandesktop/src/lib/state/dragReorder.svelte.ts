// Pointer-based vertical reorder for the left-sidebar lists (project cards and
// worktree rows).
//
// Why pointer events, not HTML5 drag-and-drop: Tauri's native OS drag-drop (used
// to drop files onto a terminal) suppresses HTML5 dnd inside the WebView, so a
// row couldn't be dragged at all — the same reason the terminal tab-strip and the
// split dividers use pointer events. A click only promotes to a drag past a small
// threshold, so taps still activate the row; after a real drag the follow-up
// `click` is swallowed so a reorder never doubles as a selection.
//
// Rows must expose `data-drag-key` (their stable identity) and `data-drag-index`
// (their position). Call `createDragReorder` once at a component's top level.

import { reorderByDrag } from "$lib/sidebar-sort";

export interface DragReorderOptions {
  /** Current keys in the order they're rendered (reactive). */
  keys: () => string[];
  /** Called with the new key order when a drag completes over a valid slot. */
  onCommit: (orderedKeys: string[]) => void;
  /** Elements matching this selector never start a drag (buttons, links, …). */
  ignoreSelector?: string;
}

interface DragState {
  key: string;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  dragging: boolean;
}

const THRESHOLD_PX = 5;
const DEFAULT_IGNORE = "button, a, input, [data-no-drag]";

export function createDragReorder(opts: DragReorderOptions) {
  const ignore = opts.ignoreSelector ?? DEFAULT_IGNORE;

  let drag = $state<DragState | null>(null);
  let dropIndex = $state<number | null>(null);
  let suppressNextClick = false;

  function pointerDown(e: PointerEvent, key: string) {
    if (e.button !== 0) return; // left button only
    if ((e.target as HTMLElement).closest(ignore)) return; // let controls work
    drag = {
      key,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      dragging: false,
    };
  }

  function pointerMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.dragging) {
      const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
      if (moved < THRESHOLD_PX) return;
      drag.dragging = true;
      (e.currentTarget as HTMLElement).setPointerCapture(drag.pointerId);
    }
    resolveDrop(e.clientX, e.clientY);
  }

  function pointerUp(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(drag.pointerId);
    const wasDragging = drag.dragging;
    const key = drag.key;
    const idx = dropIndex;
    drag = null;
    dropIndex = null;
    if (wasDragging) {
      suppressNextClick = true; // swallow the click this drag would otherwise fire
      if (idx != null) {
        const next = reorderByDrag(opts.keys(), key, idx);
        opts.onCommit(next);
      }
    }
  }

  /** Resolve the insertion index from the row under the pointer: before it when
   *  the pointer is in its top half, after it in the bottom half. */
  function resolveDrop(x: number, y: number) {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const row = el?.closest("[data-drag-key]") as HTMLElement | null;
    const idxAttr = row?.getAttribute("data-drag-index");
    if (!row || idxAttr == null) {
      dropIndex = null;
      return;
    }
    const rect = row.getBoundingClientRect();
    const below = y > rect.top + rect.height / 2;
    dropIndex = Number(idxAttr) + (below ? 1 : 0);
  }

  return {
    /** Whether a drag is currently in progress (past the threshold). */
    get active() {
      return !!drag?.dragging;
    },
    /** The key being dragged (for dimming its source row), or null. */
    get draggingKey() {
      return drag?.dragging ? drag.key : null;
    },
    /** Live pointer position, for a floating drag label. */
    get x() {
      return drag?.x ?? 0;
    },
    get y() {
      return drag?.y ?? 0;
    },
    /** Whether the insertion marker sits at slot `index`. */
    isDropAt(index: number) {
      return !!drag?.dragging && dropIndex === index;
    },
    /** True once (per drag) if the pending click should be swallowed — call it at
     *  the top of the row's `onclick` and bail when it returns true. */
    consumeClick() {
      if (suppressNextClick) {
        suppressNextClick = false;
        return true;
      }
      return false;
    },
    pointerDown,
    pointerMove,
    pointerUp,
  };
}

export type DragReorder = ReturnType<typeof createDragReorder>;
