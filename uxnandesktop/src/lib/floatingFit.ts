// Where a panel that floats beside an anchor fits — the chat composer's
// suggestion list, which opens over the composer. The list lives inside the
// pane that scrolls it, so whatever runs past that pane's edge is cut off: a
// new chat's composer sits mid-pane, and a long list of files ran up under the
// tabs, hiding its first rows. The panel therefore takes the side with room
// (above first, where it reads as rising out of the composer) and never grows
// past the space that side really has.

/** A vertical extent in viewport pixels. */
export interface Span {
  top: number;
  bottom: number;
}

/** Which side of the anchor the panel opens on, and the tallest it may be. */
export interface PanelFit {
  side: "above" | "below";
  maxHeight: number;
}

/** Below this much room above, a side with more room is taken instead. */
export const MIN_COMFORTABLE_HEIGHT = 200;

/**
 * Where a panel at most [preferred] px tall fits beside [anchor] inside
 * [clip] (the box that cuts it off), leaving [gap] px between panel and anchor
 * and between panel and the clip's edge.
 */
export function fitPanel(anchor: Span, clip: Span, preferred: number, gap = 8): PanelFit {
  const above = Math.max(0, anchor.top - clip.top - gap * 2);
  const below = Math.max(0, clip.bottom - anchor.bottom - gap * 2);
  const side = above >= Math.min(preferred, MIN_COMFORTABLE_HEIGHT) || above >= below ? "above" : "below";
  return { side, maxHeight: Math.min(preferred, side === "above" ? above : below) };
}

/** The box that clips [el]: its nearest ancestor that scrolls or hides its
 *  overflow, or the window. */
export function clipSpan(el: Element): Span {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY !== "visible") {
      const rect = node.getBoundingClientRect();
      return { top: Math.max(0, rect.top), bottom: Math.min(window.innerHeight, rect.bottom) };
    }
  }
  return { top: 0, bottom: window.innerHeight };
}
