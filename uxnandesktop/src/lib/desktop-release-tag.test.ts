import { describe, expect, it } from "vitest";
import { parseDesktopReleaseTag } from "../../scripts/desktop-release-tag.mjs";

describe("parseDesktopReleaseTag", () => {
  it("classifies a numeric stable tag", () => {
    expect(parseDesktopReleaseTag("desktop-stable-v0.0.10")).toEqual({
      channel: "stable",
      prerelease: false,
      version: "0.0.10",
    });
  });

  it("classifies a dated nightly tag", () => {
    expect(parseDesktopReleaseTag("desktop-nightly-v0.0.11-nightly.20260712.2")).toEqual({
      channel: "nightly",
      prerelease: true,
      version: "0.0.11-nightly.20260712.2",
    });
  });

  it.each([
    "desktop-v0.0.10-alpha.20260712",
    "desktop-stable-v0.0.10-nightly.20260712.1",
    "desktop-nightly-v0.0.11-nightly.20260230.1",
    "desktop-nightly-v0.0.11-nightly.20260712.0",
    "desktop-nightly-v0.0.11",
  ])("rejects ambiguous or malformed tag %s", (tag) => {
    expect(() => parseDesktopReleaseTag(tag)).toThrow("Invalid Desktop release tag");
  });
});
