import { afterEach, describe, expect, it } from "vitest";
import { clearReadingPositions, readingPosition, saveReadingPosition } from "./readingPosition";

afterEach(clearReadingPositions);

describe("reading position", () => {
  it("keeps the last position per conversation", () => {
    expect(readingPosition("t1")).toBeUndefined();
    saveReadingPosition("t1", { top: 120, atEnd: false });
    saveReadingPosition("t2", { top: 0, atEnd: true });
    saveReadingPosition("t1", { top: 480, atEnd: false });
    expect(readingPosition("t1")).toEqual({ top: 480, atEnd: false });
    expect(readingPosition("t2")).toEqual({ top: 0, atEnd: true });
  });
});
