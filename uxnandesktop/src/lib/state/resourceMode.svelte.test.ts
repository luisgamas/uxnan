// The mirror the headless automations runner reads.
//
// That runner is its own process and runs with the app closed, so it cannot ask
// the policy engine what concurrency the person's profile allows — it reads the
// number this store leaves in the settings. These tests pin the two things that
// make the mirror trustworthy: every policy write refreshes it, and a startup
// reconcile fixes a document written before it existed (or by a build that did
// not write it), without rewriting settings that already agree.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResourceModeSettings } from "$lib/types";

const settings: { resourceMode?: ResourceModeSettings } = {};
const persistSettings = vi.fn().mockResolvedValue(undefined);

vi.mock("./app.svelte", () => ({ app: { settings, persistSettings: () => persistSettings() } }));

const { resourceMode } = await import("./resourceMode.svelte");

describe("the runner's concurrency mirror", () => {
  beforeEach(() => {
    delete settings.resourceMode;
    persistSettings.mockClear();
  });

  it("is written with every policy change, carrying that profile's number", () => {
    resourceMode.setProfile("efficient");
    expect(settings.resourceMode?.profile).toBe("efficient");
    expect(settings.resourceMode?.resolvedOrchestrationConcurrency).toBe(2);

    resourceMode.setProfile("performance");
    expect(settings.resourceMode?.resolvedOrchestrationConcurrency).toBe(4);

    // An override is the person's explicit choice, so it is what the runner
    // gets too — not the preset it overrode.
    resourceMode.setOverride("orchestrationConcurrency", 7);
    expect(settings.resourceMode?.resolvedOrchestrationConcurrency).toBe(7);
    resourceMode.clearOverride("orchestrationConcurrency");
    expect(settings.resourceMode?.resolvedOrchestrationConcurrency).toBe(4);
  });

  it("reconciles a document that predates it, and leaves an agreeing one alone", () => {
    // What an older build wrote: a profile, no mirror. The runner would fall
    // back to 4 while this app dispatches by 2.
    settings.resourceMode = { profile: "efficient", overrides: {}, autoSleep: false, schemaVersion: 1 };
    resourceMode.syncRunnerBudget();
    expect(settings.resourceMode?.resolvedOrchestrationConcurrency).toBe(2);
    expect(settings.resourceMode?.profile).toBe("efficient");
    expect(persistSettings).toHaveBeenCalledTimes(1);

    // Already in step: nothing is written, so a startup reconcile costs no disk.
    persistSettings.mockClear();
    resourceMode.syncRunnerBudget();
    expect(persistSettings).not.toHaveBeenCalled();
  });

  it("reconciles missing settings to the default profile's number", () => {
    resourceMode.syncRunnerBudget();
    expect(settings.resourceMode?.profile).toBe("balanced");
    expect(settings.resourceMode?.resolvedOrchestrationConcurrency).toBe(4);
  });
});
