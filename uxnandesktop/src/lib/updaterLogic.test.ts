import { describe, expect, it } from "vitest";
import {
  checkOutcome,
  downloadFraction,
  nextInstallAction,
} from "./updaterLogic";

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

describe("checkOutcome", () => {
  it("reports the plain cases when nothing is staged", () => {
    expect(checkOutcome(null, null)).toBe("upToDate");
    expect(checkOutcome("0.0.12", null)).toBe("available");
  });

  it("keeps a staged download when the check re-reports that same version", () => {
    // The check compares against the *running* build, so it keeps offering the
    // version already downloaded — that must not trigger a second download.
    expect(checkOutcome("0.0.12", "0.0.12")).toBe("keepStaged");
  });

  it("keeps a staged download when the check finds nothing", () => {
    // e.g. the release was pulled: the staged installer stays the user's choice.
    expect(checkOutcome(null, "0.0.12")).toBe("keepStaged");
  });

  it("supersedes a staged download when a different version is offered", () => {
    expect(checkOutcome("0.0.13", "0.0.12")).toBe("superseded");
    // Also on a channel switch, where the other channel's build differs.
    expect(checkOutcome("0.0.12", "0.0.13-nightly.20260810.1")).toBe(
      "superseded",
    );
  });

  it("never keeps bytes the installer would reject as stale", () => {
    for (const [found, staged] of [
      ["0.0.13", "0.0.12"],
      ["0.0.12", "0.0.11"],
    ] as const) {
      expect(checkOutcome(found, staged)).not.toBe("keepStaged");
    }
  });
});
