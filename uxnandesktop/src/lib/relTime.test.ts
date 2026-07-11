import { describe, it, expect } from "vitest";
import { relTime } from "./relTime";

describe("relTime", () => {
  const now = 1_700_000_000_000;

  it("shows 'now' under a minute (and at zero)", () => {
    expect(relTime(now, now)).toBe("now");
    expect(relTime(now - 30_000, now)).toBe("now");
    expect(relTime(now - 59_000, now)).toBe("now");
  });

  it("rounds down to whole minutes", () => {
    expect(relTime(now - 60_000, now)).toBe("1m");
    expect(relTime(now - 5 * 60_000, now)).toBe("5m");
    expect(relTime(now - 59 * 60_000, now)).toBe("59m");
  });

  it("switches to hours then days", () => {
    expect(relTime(now - 60 * 60_000, now)).toBe("1h");
    expect(relTime(now - 23 * 3_600_000, now)).toBe("23h");
    expect(relTime(now - 24 * 3_600_000, now)).toBe("1d");
    expect(relTime(now - 3 * 86_400_000, now)).toBe("3d");
  });

  it("clamps a future timestamp to 'now'", () => {
    expect(relTime(now + 10_000, now)).toBe("now");
  });
});
