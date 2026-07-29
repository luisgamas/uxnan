import { describe, expect, it, beforeEach } from "vitest";
import {
  registerStatusSweep,
  requestSweep,
  shouldSweep,
  type SweepDecision,
} from "./statusSweepRegistry";

const base: SweepDecision = {
  inFlight: false,
  force: false,
  hidden: false,
  now: 100_000,
  lastSweep: 0,
  intervalMs: 15_000,
};

describe("shouldSweep", () => {
  it("runs once the interval has passed", () => {
    expect(shouldSweep({ ...base, lastSweep: 84_000 })).toBe(true); // 16 s ago
  });

  it("holds off inside the interval", () => {
    expect(shouldSweep({ ...base, lastSweep: 95_000 })).toBe(false); // 5 s ago
  });

  it("never overlaps a running sweep — not even when forced", () => {
    expect(shouldSweep({ ...base, inFlight: true })).toBe(false);
    expect(shouldSweep({ ...base, inFlight: true, force: true })).toBe(false);
  });

  it("forced sweeps skip both the interval and the hidden check", () => {
    // An agent reporting / the window regaining focus must not wait 15 s.
    expect(shouldSweep({ ...base, force: true, lastSweep: 99_999 })).toBe(true);
    expect(shouldSweep({ ...base, force: true, hidden: true })).toBe(true);
  });

  it("skips unforced sweeps while the window is hidden", () => {
    expect(shouldSweep({ ...base, hidden: true, lastSweep: 0 })).toBe(false);
  });
});

describe("registry", () => {
  beforeEach(() => registerStatusSweep(() => {}));

  it("routes a request to the registered sweep", () => {
    let calls = 0;
    registerStatusSweep(() => calls++);
    requestSweep();
    requestSweep();
    expect(calls).toBe(2);
  });

  it("re-registering replaces the previous implementation", () => {
    let first = 0;
    let second = 0;
    registerStatusSweep(() => first++);
    registerStatusSweep(() => second++);
    requestSweep();
    expect(first).toBe(0);
    expect(second).toBe(1);
  });
});
