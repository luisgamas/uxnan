// What a bar at the top of the window must keep clear of.
//
// There is no title bar: every panel runs to the top edge, and the window's own
// controls float over whatever lies beneath them — the macOS traffic lights at
// the top-left, and `WindowControls` (Quick Commands, plus minimize / maximize /
// close off macOS) at the top-right. A bar that reaches one of those corners
// has to leave that corner empty, or its tabs and buttons end up under the
// controls. Which bar reaches a corner changes with the layout: hide the left
// sidebar and the center tab strip becomes the top-left bar; hide the right
// panel and it becomes the top-right one.

import { shell } from "$lib/design";

/** Which top corners of the window a bar reaches. */
export interface TitlebarEdges {
  /** The bar starts at the window's left edge. */
  left: boolean;
  /** The bar ends at the window's right edge. */
  right: boolean;
}

/** The padding classes a top bar needs for the corners it reaches. On macOS
 *  the left corner holds the traffic lights; elsewhere the OS chrome is off and
 *  nothing is drawn there. The right corner always holds `WindowControls`. */
export function titlebarInsets(edges: TitlebarEdges, mac: boolean): string {
  const out: string[] = [];
  if (edges.left && mac) out.push(shell.macTrafficLightsInset);
  if (edges.right) out.push(mac ? shell.macWindowControlsInset : shell.windowControlsInset);
  return out.join(" ");
}

/** Whether a region of the center area, placed at `rect` (percentages of the
 *  area), touches the area's top-left / top-right corner. */
export function regionEdges(rect: { x: number; y: number; w: number }): TitlebarEdges {
  const top = rect.y < 0.01;
  return {
    left: top && rect.x < 0.01,
    right: top && rect.x + rect.w > 99.99,
  };
}
