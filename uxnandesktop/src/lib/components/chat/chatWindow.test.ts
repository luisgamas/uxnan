import { describe, expect, it } from "vitest";
import type { Turn } from "$shared/models/thread";
import {
  EVERYTHING,
  grownStart,
  hiddenAbove,
  newestWindowStart,
  startIncluding,
  windowed,
} from "./chatWindow";

function turns(count: number, extra: Partial<Turn>[] = []): Turn[] {
  const list = Array.from({ length: count }, (_, i) => ({ id: `t${i + 1}`, seq: i + 1 }) as Turn);
  return [...list, ...extra.map((t, i) => ({ id: `x${i}`, ...t }) as Turn)];
}

describe("chat timeline window", () => {
  it("starts at the newest turns, or renders everything when there are few", () => {
    expect(newestWindowStart(turns(10), 6)).toBe(5);
    expect(newestWindowStart(turns(6), 6)).toBe(EVERYTHING);
    expect(newestWindowStart(turns(0), 6)).toBe(EVERYTHING);
  });

  it("renders the window and every turn not numbered yet", () => {
    const list = turns(10, [{}]);
    expect(windowed(list, 8).map((t) => t.id)).toEqual(["t8", "t9", "t10", "x0"]);
    expect(windowed(list, EVERYTHING)).toHaveLength(11);
  });

  it("does not slide when newer turns arrive", () => {
    const start = newestWindowStart(turns(10), 6);
    expect(windowed(turns(14), start).map((t) => t.id)[0]).toBe("t5");
  });

  it("counts and grows toward the past until the whole history is in", () => {
    const list = turns(20);
    expect(hiddenAbove(list, 15)).toBe(14);
    expect(grownStart(list, 15, 6)).toBe(9);
    expect(grownStart(list, 5, 6)).toBe(EVERYTHING);
    expect(hiddenAbove(list, EVERYTHING)).toBe(0);
  });

  it("widens to include a turn above it, never narrows", () => {
    const list = turns(20);
    expect(startIncluding(list, 15, "t3")).toBe(3);
    expect(startIncluding(list, 15, "t18")).toBe(15);
    expect(startIncluding(list, 15, "missing")).toBe(15);
  });
});
