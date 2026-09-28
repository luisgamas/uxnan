// Where a conversation's timeline should sit, decided each time its size
// changes: when it is shown (a chat tab or workspace is hidden with
// `display: none`, where it has no height and ignores `scrollTop`), when its
// turns arrive, and when content grows (a streamed reply, a late image).
//
// Deciding on size rather than on "the turns changed" is what makes a chat that
// loaded while hidden still open at its end, and a place kept while hidden
// survive being hidden.

/** The scroller's box, as the browser reports it. */
export interface ScrollBox {
  clientHeight: number;
  scrollHeight: number;
}

/** What the view holds on to between two settles. */
export interface ScrollHold {
  /** Whether the reader is at the end and should stay there. */
  following: boolean;
  /** An offset still to be put back once the view can show it. */
  pending: number | null;
  /** The last offset the reader was at while the view was visible. */
  lastTop: number;
}

/** Where to scroll to (`null`: leave it) and what to hold on to next. */
export interface Settled {
  top: number | null;
  pending: number | null;
}

/**
 * Settle [box] given what the view holds: a hidden view keeps the reader's
 * place for later; a visible one puts back a pending place once there is
 * content to hold it, and otherwise keeps a following reader at the end.
 */
export function settleScroll(box: ScrollBox, hold: ScrollHold, hasContent: boolean): Settled {
  if (box.clientHeight === 0) {
    return { top: null, pending: hold.following ? null : (hold.pending ?? hold.lastTop) };
  }
  if (hold.pending !== null) {
    return hasContent ? { top: hold.pending, pending: null } : { top: null, pending: hold.pending };
  }
  return { top: hold.following ? box.scrollHeight : null, pending: null };
}
