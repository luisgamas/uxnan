// Where the person was reading each conversation, so returning to it opens
// there instead of at the bottom. Kept for the app session only (a restart
// opens every conversation at its end): a position saved days ago points at a
// timeline that has since moved on.

/** A conversation's saved scroll: its offset, and whether it sat at the end. */
export interface ReadingPosition {
  top: number;
  atEnd: boolean;
}

const positions = new Map<string, ReadingPosition>();

/** Remember where [threadId] was left. */
export function saveReadingPosition(threadId: string, position: ReadingPosition): void {
  positions.set(threadId, position);
}

/** Where [threadId] was left, if it was read this session. */
export function readingPosition(threadId: string): ReadingPosition | undefined {
  return positions.get(threadId);
}

/** Forget every position (tests). */
export function clearReadingPositions(): void {
  positions.clear();
}
