import { describe, expect, it } from "vitest";
import {
  USAGE_CATALOG,
  activatableUsageProviders,
  usageProvider,
  usageProviderForAgent,
} from "./usageCatalog";

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

  it("maps a bridge agent to the plan it spends", () => {
    expect(usageProviderForAgent("claude-code")?.id).toBe("claude");
    expect(usageProviderForAgent("codex")?.id).toBe("codex");
    expect(usageProviderForAgent("grok")?.id).toBe("grok");
    expect(usageProviderForAgent("opencode")).toBeUndefined();
    expect(usageProviderForAgent(undefined)).toBeUndefined();
  });
});
