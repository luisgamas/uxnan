import { describe, expect, it } from "vitest";
import { currentOS, osLabel } from "./platform";

// The status bar's "untested platform" badge and the per-OS defaults (agent
// launch shell, dialog filters, junction guard) all hang off this detection —
// misreading a user agent silently gives a Mac user Windows behavior.

describe("currentOS", () => {
  it("recognises the three desktop webview user agents", () => {
    expect(
      currentOS(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 Edg/120",
      ),
    ).toBe("windows");
    expect(
      currentOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)"),
    ).toBe("macos");
    expect(
      currentOS("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)"),
    ).toBe("linux");
  });

  it("answers 'other' for an empty or unknown agent instead of guessing", () => {
    expect(currentOS("")).toBe("other");
    expect(currentOS("SomethingEmbedded/1.0")).toBe("other");
  });
});

describe("osLabel", () => {
  it("names each OS for the untested-platform notice", () => {
    expect(osLabel("windows")).toBe("Windows");
    expect(osLabel("macos")).toBe("macOS");
    expect(osLabel("linux")).toBe("Linux");
    expect(osLabel("other")).toBe("this platform");
  });
});
