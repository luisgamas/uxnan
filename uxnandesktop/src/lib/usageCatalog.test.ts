import { describe, expect, it } from "vitest";
import { USAGE_CATALOG, activatableUsageProviders, usageProvider } from "./usageCatalog";

describe("activatableUsageProviders", () => {
  it("drops the deprecated entries from the catalog", () => {
    const offered = activatableUsageProviders();
    expect(offered.every((p) => !p.deprecated)).toBe(true);
    expect(offered.length).toBe(USAGE_CATALOG.filter((p) => !p.deprecated).length);
  });

  it("no longer offers Gemini CLI, discontinued in favour of Antigravity", () => {
    expect(activatableUsageProviders().map((p) => p.id)).not.toContain("gemini");
  });

  it("keeps every non-deprecated provider offered", () => {
    expect(activatableUsageProviders().map((p) => p.id)).toEqual([
      "codex",
      "claude",
      "copilot",
      "grok",
    ]);
  });
});

describe("usageProvider", () => {
  // A deprecated provider stays fully resolvable: someone who activated Gemini
  // before it was hidden must still see its real name and logo, not a raw id.
  it("resolves a deprecated provider so an activated one keeps its identity", () => {
    const gemini = usageProvider("gemini");
    expect(gemini?.name).toBe("Gemini CLI");
    expect(gemini?.logo).toBe("gemini");
    expect(gemini?.deprecated).toBe(true);
  });

  it("returns undefined for an unknown id", () => {
    // @ts-expect-error — guarding the runtime path a stale persisted config hits.
    expect(usageProvider("nope")).toBeUndefined();
  });
});
