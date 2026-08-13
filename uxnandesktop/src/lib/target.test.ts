import { describe, expect, it } from "vitest";
import {
  expectation,
  isLocalTarget,
  LOCAL_GENERATION,
  LOCAL_TARGET,
  parseTargetId,
  sshHostId,
  targetOf,
} from "./target";

describe("isLocalTarget / targetOf", () => {
  it("treats absent and empty as local (everything written before targets)", () => {
    expect(isLocalTarget(undefined)).toBe(true);
    expect(isLocalTarget(null)).toBe(true);
    expect(isLocalTarget(LOCAL_TARGET)).toBe(true);
    expect(targetOf(undefined)).toBe(LOCAL_TARGET);
  });

  it("does not treat a remote target as local", () => {
    expect(isLocalTarget("ssh:h1")).toBe(false);
    expect(targetOf("ssh:h1")).toBe("ssh:h1");
  });
});

describe("parseTargetId", () => {
  it("accepts the two forms this build knows", () => {
    expect(parseTargetId("local")).toBe("local");
    expect(parseTargetId("")).toBe("local");
    expect(parseTargetId("  ssh:h1 ")).toBe("ssh:h1");
  });

  it("rejects malformed and not-yet-supported ids instead of degrading to local", () => {
    expect(parseTargetId("ssh:")).toBeNull();
    expect(parseTargetId("wsl:Ubuntu")).toBeNull(); // reserved, not wired yet
    expect(parseTargetId("nonsense")).toBeNull();
  });
});

describe("sshHostId", () => {
  it("extracts the host id, and only for ssh targets", () => {
    expect(sshHostId("ssh:h-42")).toBe("h-42");
    expect(sshHostId("local")).toBeNull();
    expect(sshHostId(undefined)).toBeNull();
  });
});

describe("expectation", () => {
  it("pins local work to the local generation", () => {
    expect(expectation(undefined)).toEqual({
      targetId: LOCAL_TARGET,
      generation: LOCAL_GENERATION,
    });
    // A caller passing a generation for local work cannot invent one.
    expect(expectation("local", 9).generation).toBe(LOCAL_GENERATION);
  });

  it("carries the connection generation for a remote target", () => {
    expect(expectation("ssh:h1", 4)).toEqual({ targetId: "ssh:h1", generation: 4 });
  });
});
