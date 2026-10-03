import { describe, expect, it } from "vitest";
import { effectiveAccessMode } from "./accessMode";

// The same cases as shared/test/access-mode.test.ts: the desktop shows the
// mode the bridge will run.
describe("effectiveAccessMode", () => {
  it("keeps a stored mode the agent offers", () => {
    expect(
      effectiveAccessMode({ accessModes: ["requestApproval", "fullAccess"], defaultAccessMode: "fullAccess" }, "requestApproval"),
    ).toBe("requestApproval");
  });

  it("runs a mode the agent does not offer as its default", () => {
    const caps = { accessModes: ["approveForMe", "fullAccess"] as const, defaultAccessMode: "fullAccess" as const };
    const offered = { ...caps, accessModes: [...caps.accessModes] };
    expect(effectiveAccessMode(offered, "plan")).toBe("fullAccess");
    expect(effectiveAccessMode(offered, undefined)).toBe("fullAccess");
  });

  it("falls back to the first mode when the default is not listed", () => {
    expect(effectiveAccessMode({ accessModes: ["requestApproval"], defaultAccessMode: "fullAccess" }, undefined)).toBe(
      "requestApproval",
    );
  });

  it("has no mode for an agent that offers none", () => {
    expect(effectiveAccessMode({}, "fullAccess")).toBeUndefined();
    expect(effectiveAccessMode({ accessModes: [] }, "plan")).toBeUndefined();
  });
});
