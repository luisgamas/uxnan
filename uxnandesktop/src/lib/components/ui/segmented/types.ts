import type { IconNode } from "$lib/components/ui/icon";

/** One option of a segmented control. Give it a `label`, an `icon`, a text
 *  `glyph` (`Aa`, `.*`), or a combination; an option without a label needs a
 *  `tooltip`, which also becomes its accessible name. */
export interface SegmentedOption {
  value: string;
  label?: string;
  icon?: IconNode;
  glyph?: string;
  /** A count beside the label (hidden at 0). */
  count?: number;
  tooltip?: string;
  disabled?: boolean;
  /** Extra classes for this option alone (rare: a glyph's own typography). */
  class?: string;
}
