import { describe, expect, it } from "vitest";
import { groupModels, modelFor, modelName, modelProvider } from "./models";

describe("model presentation", () => {
  it("splits provider and model name", () => {
    expect(modelProvider("anthropic/claude-sonnet-5")).toBe("anthropic");
    expect(modelProvider("openrouter/meta/llama-4")).toBe("openrouter/meta");
    expect(modelProvider("opus")).toBeNull();
    expect(modelName({ id: "anthropic/claude-sonnet-5", displayName: "anthropic/claude-sonnet-5" })).toBe(
      "claude-sonnet-5",
    );
    expect(modelName({ id: "opus", displayName: "Opus 5" })).toBe("Opus 5");
  });

  it("groups by provider, bare ids first, keeping the agent's order", () => {
    const groups = groupModels([
      { id: "openai/gpt-6", displayName: "gpt-6" },
      { id: "fable", displayName: "Fable" },
      { id: "anthropic/opus", displayName: "opus" },
      { id: "openai/gpt-6-mini", displayName: "gpt-6-mini" },
    ]);
    expect(groups.map((g) => [g.provider, g.models.map((m) => m.id)])).toEqual([
      [null, ["fable"]],
      ["openai", ["openai/gpt-6", "openai/gpt-6-mini"]],
      ["anthropic", ["anthropic/opus"]],
    ]);
  });
});

describe("modelFor", () => {
  const models = [
    { id: "opus", displayName: "Opus 5.5", version: "claude-opus-5-5" },
    { id: "claude-opus-4-8", displayName: "Opus 4.8", isLegacy: true },
  ];
  it("finds a model by its id, else the alias that runs it", () => {
    expect(modelFor(models, "claude-opus-4-8")?.displayName).toBe("Opus 4.8");
    // A thread pinned to the concrete id an alias runs reads as that alias.
    expect(modelFor(models, "claude-opus-5-5")?.id).toBe("opus");
    expect(modelFor(models, "claude-sonnet-5")).toBeUndefined();
  });
});
