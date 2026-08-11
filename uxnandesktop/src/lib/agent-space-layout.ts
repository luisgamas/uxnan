export const AGENT_AVATAR_FOOTPRINT = 28;
export const AGENT_OVERFLOW_FOOTPRINT = 28;

/** Returns leading avatars that fit while reserving one +N footprint if needed. */
export function visibleAgentCount(
  total: number,
  width: number,
  maxVisible = 4,
  avatarFootprint = AGENT_AVATAR_FOOTPRINT,
  overflowFootprint = AGENT_OVERFLOW_FOOTPRINT,
): number {
  const safeTotal = Math.max(0, Math.floor(total));
  const safeWidth = Math.max(0, width);
  const cap = Math.max(0, Math.floor(maxVisible));
  const limit = Math.min(safeTotal, cap);
  if (safeTotal <= limit && safeTotal * avatarFootprint <= safeWidth) return safeTotal;
  for (let visible = limit; visible >= 0; visible -= 1) {
    if (visible * avatarFootprint + overflowFootprint <= safeWidth) return visible;
  }
  return 0;
}
