import { describe, expect, it } from "vitest";
import { downloadFraction, nextInstallAction } from "./updaterLogic";

describe("downloadFraction", () => {
  it("returns a 0–1 fraction when the total is known", () => {
    expect(downloadFraction(0, 100)).toBe(0);
    expect(downloadFraction(50, 100)).toBe(0.5);
    expect(downloadFraction(100, 100)).toBe(1);
  });

  it("returns null when the total is unknown or non-positive", () => {
    expect(downloadFraction(10, null)).toBeNull();
    expect(downloadFraction(10, undefined)).toBeNull();
    expect(downloadFraction(10, 0)).toBeNull();
    expect(downloadFraction(10, -5)).toBeNull();
  });

  it("clamps overshoot/undershoot into [0, 1]", () => {
    expect(downloadFraction(150, 100)).toBe(1);
    expect(downloadFraction(-10, 100)).toBe(0);
  });
});

describe("nextInstallAction", () => {
  it("whenIdle installs immediately only when no agent is working", () => {
    expect(nextInstallAction("whenIdle", false)).toBe("installNow");
    expect(nextInstallAction("whenIdle", true)).toBe("armIdle");
  });

  it("ask and manual always wait for an explicit action, busy or not", () => {
    expect(nextInstallAction("ask", false)).toBe("wait");
    expect(nextInstallAction("ask", true)).toBe("wait");
    expect(nextInstallAction("manual", false)).toBe("wait");
    expect(nextInstallAction("manual", true)).toBe("wait");
  });

  it("never auto-installs while an agent is working", () => {
    for (const policy of ["ask", "whenIdle", "manual"] as const) {
      expect(nextInstallAction(policy, true)).not.toBe("installNow");
    }
  });
});
