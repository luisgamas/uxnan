import { describe, expect, it } from "vitest";
import { modelFromArgs } from "./agentModel";

describe("modelFromArgs", () => {
  it("returns null when there are no args", () => {
    expect(modelFromArgs(undefined)).toBeNull();
    expect(modelFromArgs([])).toBeNull();
  });

  it("returns null when nothing pins a model", () => {
    expect(modelFromArgs(["--dangerously-skip-permissions"])).toBeNull();
  });

  it("reads the separate-value form", () => {
    expect(modelFromArgs(["--model", "opus"])).toBe("opus");
    expect(modelFromArgs(["--yolo", "--model", "gpt-5.2-codex"])).toBe("gpt-5.2-codex");
  });

  it("reads the equals form", () => {
    expect(modelFromArgs(["--model=sonnet"])).toBe("sonnet");
  });

  it("reads the short flag", () => {
    expect(modelFromArgs(["-m", "haiku"])).toBe("haiku");
    expect(modelFromArgs(["-m=haiku"])).toBe("haiku");
  });

  it("does not swallow the next flag when the value is missing", () => {
    expect(modelFromArgs(["--model"])).toBeNull();
    expect(modelFromArgs(["--model", "--resume"])).toBeNull();
    expect(modelFromArgs(["--model="])).toBeNull();
  });

  it("ignores blank args and trims the value", () => {
    expect(modelFromArgs(["", "  ", "--model", "  opus  "])).toBe("opus");
  });

  it("takes the first pin when a profile repeats the flag", () => {
    expect(modelFromArgs(["--model", "opus", "--model", "sonnet"])).toBe("opus");
  });
});
