/**
 * Auto-sleep planner. The guards ARE the feature: a working agent is never
 * slept automatically, unknown recency is never guessed at, the active and
 * Global workspaces are untouchable, and everything is double-gated behind the
 * feature flag. Time is an explicit input, so every rule runs under a fake
 * clock.
 */

import { describe, expect, it } from "vitest";

import {
  planAutoSleep,
  SUGGEST_COOLDOWN_MS,
  type AutoSleepCandidate,
  type AutoSleepInput,
} from "./autoSleep";

const NOW = 10_000_000;
const HOUR = 60 * 60 * 1000;

function candidate(overrides: Partial<AutoSleepCandidate> = {}): AutoSleepCandidate {
  return {
    key: "C:/work/repo",
    liveTerminals: 2,
    asleep: false,
    blockers: 0,
    lastActiveMs: NOW - HOUR,
    ...overrides,
  };
}

function input(overrides: Partial<AutoSleepInput> = {}): AutoSleepInput {
  return {
    level: "auto",
    flagEnabled: true,
    activeKey: "C:/work/active",
    globalKey: "",
    nowMs: NOW,
    idleMinutes: 30,
    candidates: [candidate()],
    lastPromptMs: {},
    ...overrides,
  };
}

describe("planAutoSleep", () => {
  it("sleeps an idle, blocker-free workspace at level auto", () => {
    expect(planAutoSleep(input())).toEqual([{ key: "C:/work/repo", action: "sleep" }]);
  });

  it("does nothing when the feature flag is off, whatever the level", () => {
    expect(planAutoSleep(input({ flagEnabled: false }))).toEqual([]);
  });

  it("does nothing at level off, whatever the flag", () => {
    expect(planAutoSleep(input({ level: "off" }))).toEqual([]);
  });

  it("only suggests at level suggest", () => {
    expect(planAutoSleep(input({ level: "suggest" }))).toEqual([
      { key: "C:/work/repo", action: "suggest" },
    ]);
  });

  it("NEVER auto-sleeps a workspace with a working agent — it suggests instead", () => {
    expect(planAutoSleep(input({ candidates: [candidate({ blockers: 1 })] }))).toEqual([
      { key: "C:/work/repo", action: "suggest" },
    ]);
  });

  it("skips the active workspace and the Global scratch space", () => {
    expect(
      planAutoSleep(
        input({
          candidates: [candidate({ key: "C:/work/active" }), candidate({ key: "" })],
        }),
      ),
    ).toEqual([]);
  });

  it("skips asleep workspaces and workspaces with no live terminals", () => {
    expect(
      planAutoSleep(
        input({
          candidates: [candidate({ asleep: true }), candidate({ key: "x", liveTerminals: 0 })],
        }),
      ),
    ).toEqual([]);
  });

  it("never acts on a workspace whose recency is unknown", () => {
    expect(planAutoSleep(input({ candidates: [candidate({ lastActiveMs: null })] }))).toEqual([]);
  });

  it("respects the idle threshold against the fake clock", () => {
    const justUnder = candidate({ lastActiveMs: NOW - 30 * 60_000 + 1 });
    expect(planAutoSleep(input({ candidates: [justUnder] }))).toEqual([]);
    const exactly = candidate({ lastActiveMs: NOW - 30 * 60_000 });
    expect(planAutoSleep(input({ candidates: [exactly] }))).toHaveLength(1);
  });

  it("honors a longer idle threshold from the policy", () => {
    const idleOneHour = candidate({ lastActiveMs: NOW - HOUR });
    expect(planAutoSleep(input({ idleMinutes: 120, candidates: [idleOneHour] }))).toEqual([]);
  });

  it("suggestions respect the per-workspace cooldown; sleeps do not need one", () => {
    const prompted = { "C:/work/repo": NOW - 1000 };
    expect(
      planAutoSleep(input({ level: "suggest", lastPromptMs: prompted })),
    ).toEqual([]);
    // After the cooldown the suggestion returns.
    const later = input({
      level: "suggest",
      nowMs: NOW + SUGGEST_COOLDOWN_MS,
      lastPromptMs: { "C:/work/repo": NOW },
    });
    expect(planAutoSleep(later)).toHaveLength(1);
    // A blocker-free auto sleep is unaffected by the prompt history.
    expect(planAutoSleep(input({ lastPromptMs: prompted }))).toHaveLength(1);
  });

  it("handles several workspaces independently", () => {
    const decisions = planAutoSleep(
      input({
        candidates: [
          candidate({ key: "a" }),
          candidate({ key: "b", blockers: 2 }),
          candidate({ key: "c", lastActiveMs: NOW - 60_000 }),
        ],
      }),
    );
    expect(decisions).toEqual([
      { key: "a", action: "sleep" },
      { key: "b", action: "suggest" },
    ]);
  });

  it("never mutates its input", () => {
    const lastPromptMs = {};
    const candidates = [candidate()];
    planAutoSleep(input({ candidates, lastPromptMs }));
    expect(lastPromptMs).toEqual({});
    expect(candidates[0].asleep).toBe(false);
  });
});
