// The mirror the other processes read.
//
// The headless automations runner is its own process and runs with the app
// closed, and the budget itself is enforced in Rust for every process at once
// (`budget.rs`) — neither can ask this policy engine, which lives here. They
// read the numbers this store leaves in the settings. These tests pin the two
// things that make that mirror trustworthy: every policy write refreshes it,
// and a startup reconcile fixes a document written before it existed (or by a
// build that did not write it), without rewriting settings that already agree.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResourceModeSettings } from "$lib/types";

const settings: { resourceMode?: ResourceModeSettings } = {};
const persistSettings = vi.fn().mockResolvedValue(undefined);

vi.mock("./app.svelte", () => ({ app: { settings, persistSettings: () => persistSettings() } }));

const { resourceMode } = await import("./resourceMode.svelte");

describe("the mirrored agent budget", () => {
  beforeEach(() => {
    delete settings.resourceMode;
    persistSettings.mockClear();
  });

  it("is written with every policy change, carrying that profile's numbers", () => {
    resourceMode.setProfile("efficient");
    expect(settings.resourceMode?.profile).toBe("efficient");
    expect(settings.resourceMode?.resolvedBudget).toEqual({
      concurrency: 2,
      minFreeMemoryMb: 1536,
    });

    resourceMode.setProfile("performance");
    expect(settings.resourceMode?.resolvedBudget).toEqual({
      concurrency: 4,
      minFreeMemoryMb: 512,
    });

    // An override is the person's explicit choice, so it is what the other
    // processes get too — not the preset it overrode.
    resourceMode.setOverride("orchestrationConcurrency", 7);
    expect(settings.resourceMode?.resolvedBudget?.concurrency).toBe(7);
    resourceMode.setOverride("orchestrationMinFreeMemoryMb", 0);
    expect(settings.resourceMode?.resolvedBudget?.minFreeMemoryMb).toBe(0);
    resourceMode.clearOverride("orchestrationConcurrency");
    expect(settings.resourceMode?.resolvedBudget?.concurrency).toBe(4);
  });

  it("reconciles a document that predates it, and leaves an agreeing one alone", () => {
    // What an older build wrote: a profile, no mirror. The other processes
    // would fall back to 4 while this app dispatches by 2.
    settings.resourceMode = {
      profile: "efficient",
      overrides: {},
      autoSleep: false,
      schemaVersion: 1,
    };
    resourceMode.syncRunnerBudget();
    expect(settings.resourceMode?.resolvedBudget?.concurrency).toBe(2);
    expect(settings.resourceMode?.profile).toBe("efficient");
    expect(persistSettings).toHaveBeenCalledTimes(1);

    // Already in step: nothing is written, so a startup reconcile costs no disk.
    persistSettings.mockClear();
    resourceMode.syncRunnerBudget();
    expect(persistSettings).not.toHaveBeenCalled();
  });

  it("reconciles a mirror that is only half right", () => {
    // A build that mirrored the concurrency but not the memory condition: the
    // reconcile must notice the missing half rather than call it a match.
    settings.resourceMode = {
      profile: "balanced",
      overrides: {},
      autoSleep: false,
      schemaVersion: 1,
      resolvedBudget: { concurrency: 4, minFreeMemoryMb: 0 },
    };
    resourceMode.syncRunnerBudget();
    expect(settings.resourceMode?.resolvedBudget).toEqual({
      concurrency: 4,
      minFreeMemoryMb: 1024,
    });
  });

  it("reconciles missing settings to the default profile's numbers", () => {
    resourceMode.syncRunnerBudget();
    expect(settings.resourceMode?.profile).toBe("balanced");
    expect(settings.resourceMode?.resolvedBudget).toEqual({
      concurrency: 4,
      minFreeMemoryMb: 1024,
    });
  });
});
