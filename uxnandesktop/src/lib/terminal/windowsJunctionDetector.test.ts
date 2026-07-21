import { describe, expect, it } from "vitest";
import {
  matchesJunctionBlock,
  feedJunctionDetector,
  forgetJunctionBlock,
} from "./windowsJunctionDetector";

const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s);

describe("matchesJunctionBlock", () => {
  it("matches the locale-independent codes", () => {
    expect(matchesJunctionBlock("failed to run cargo metadata (os error 448)")).toBe(true);
    expect(matchesJunctionBlock("npm error errno -4094")).toBe(true);
  });

  it("matches the English message case-insensitively", () => {
    expect(matchesJunctionBlock("The path contains an UNTRUSTED MOUNT POINT.")).toBe(true);
  });

  it("ignores unrelated output (incl. other os errors)", () => {
    expect(matchesJunctionBlock("added 194 packages, and audited 195")).toBe(false);
    expect(matchesJunctionBlock("failed (os error 2)")).toBe(false);
  });
});

describe("feedJunctionDetector", () => {
  it("fires once per terminal, then stays silent until forgotten", () => {
    const id = "t-fire";
    expect(feedJunctionDetector(id, bytes("compiling..."))).toBe(false);
    expect(feedJunctionDetector(id, bytes("error (os error 448)\n"))).toBe(true);
    expect(feedJunctionDetector(id, bytes("os error 448 again"))).toBe(false);
    forgetJunctionBlock(id);
    expect(feedJunctionDetector(id, bytes("os error 448"))).toBe(true);
    forgetJunctionBlock(id);
  });

  it("catches a signature split across two chunks", () => {
    const id = "t-split";
    expect(feedJunctionDetector(id, bytes("...cargo metadata (os err"))).toBe(false);
    expect(feedJunctionDetector(id, bytes("or 448)"))).toBe(true);
    forgetJunctionBlock(id);
  });

  it("keeps terminals independent", () => {
    expect(feedJunctionDetector("guard-a", bytes("os error 448"))).toBe(true);
    expect(feedJunctionDetector("guard-b", bytes("all good here"))).toBe(false);
    forgetJunctionBlock("guard-a");
    forgetJunctionBlock("guard-b");
  });
});
