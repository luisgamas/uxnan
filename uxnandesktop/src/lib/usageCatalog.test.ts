import { describe, expect, it } from "vitest";
import { USAGE_CATALOG, activatableUsageProviders, usageProvider } from "./usageCatalog";

describe("activatableUsageProviders", () => {
  it("returns the complete catalog", () => {
    expect(activatableUsageProviders()).toEqual(USAGE_CATALOG);
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
  it("returns undefined for an unknown id", () => {
    // @ts-expect-error — guarding the runtime path a stale persisted config hits.
    expect(usageProvider("nope")).toBeUndefined();
  });
});
