// Right-panel layout metrics (runtime only — never persisted).
//
// The right panel's resizable width is floored at "every tab fits": the panel
// can't be dragged narrower than its tab strip (Files / Changes / History /
// GitHub), so the tabs never clip or spill into a horizontal scroll. The strip's
// intrinsic width is measured live in `RightPanel.svelte` (it depends on the UI
// language and whether the GitHub tab is shown) and read here by the shell
// (`+page.svelte`) as the panel's minimum. At exactly that minimum the strip
// fills the panel edge-to-edge, so the tabs read as centered; dragging wider
// leaves them left-aligned with the slack on the right.

/** Sensible floor when the tab strip hasn't been measured yet (or is narrower
 *  than the content below it comfortably needs). */
export const RIGHT_PANEL_MIN_FALLBACK = 300;

/** Upper bound on the right panel's width (shared with the shell resize logic). */
export const RIGHT_PANEL_MAX = 560;

class RightPanelLayout {
  /** Measured intrinsic width (px) of the tab strip — enough to fit every tab
   *  with the strip's own padding. Starts at the fallback until measured. */
  tabsWidth = $state(RIGHT_PANEL_MIN_FALLBACK);

  /** Record a fresh measurement. Ignores non-positive values (the strip hasn't
   *  laid out yet) so the min never collapses to 0 mid-render. */
  setTabsWidth(width: number): void {
    if (Number.isFinite(width) && width > 0) this.tabsWidth = Math.ceil(width);
  }

  /** The panel's effective minimum width: never below the content floor, and
   *  grown to the tab strip when the (localized) tabs need more room. */
  get min(): number {
    return Math.max(RIGHT_PANEL_MIN_FALLBACK, this.tabsWidth);
  }
}

/** Singleton shared between the right panel (writer) and the shell (reader). */
export const rightPanel = new RightPanelLayout();
