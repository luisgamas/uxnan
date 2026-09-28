import { describe, expect, it } from "vitest";

import { settleScroll } from "./chatScroll";

const shown = { clientHeight: 600, scrollHeight: 3000 };
const hidden = { clientHeight: 0, scrollHeight: 0 };

describe("settleScroll", () => {
  it("opens a following chat at its end once it is shown", () => {
    // Loaded while hidden: nothing to do, and nothing to remember.
    expect(settleScroll(hidden, { following: true, pending: null, lastTop: 0 }, true)).toEqual({
      top: null,
      pending: null,
    });
    // Shown: to the end.
    expect(settleScroll(shown, { following: true, pending: null, lastTop: 0 }, true)).toEqual({
      top: 3000,
      pending: null,
    });
  });

  it("keeps a reader who scrolled up where they are as content grows", () => {
    expect(settleScroll(shown, { following: false, pending: null, lastTop: 900 }, true)).toEqual({
      top: null,
      pending: null,
    });
  });

  it("keeps the reader's place while hidden and puts it back when shown", () => {
    const whileHidden = settleScroll(
      hidden,
      { following: false, pending: null, lastTop: 900 },
      true,
    );
    expect(whileHidden).toEqual({ top: null, pending: 900 });
    expect(
      settleScroll(shown, { following: false, pending: whileHidden.pending, lastTop: 900 }, true),
    ).toEqual({
      top: 900,
      pending: null,
    });
  });

  it("waits for the turns before putting a saved place back", () => {
    expect(settleScroll(shown, { following: false, pending: 1200, lastTop: 0 }, false)).toEqual({
      top: null,
      pending: 1200,
    });
    expect(settleScroll(shown, { following: false, pending: 1200, lastTop: 0 }, true)).toEqual({
      top: 1200,
      pending: null,
    });
  });

  it("does not trade a saved place for the last one while still hidden", () => {
    expect(settleScroll(hidden, { following: false, pending: 1200, lastTop: 0 }, false)).toEqual({
      top: null,
      pending: 1200,
    });
  });
});
