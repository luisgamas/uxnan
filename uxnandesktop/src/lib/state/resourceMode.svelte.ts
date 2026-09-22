// Resource-mode store — the one reactive door to the policy engine.
//
// Consumers (git sweeps, GitHub/provider polling, orchestration, pets,
// auto-sleep) read `resourceMode.policy` and react when it changes; the
// Settings UI writes through the setters, which persist only **normalized**
// documents — junk never reaches disk, and "use preset" really deletes the
// override instead of writing a shadow copy of the preset value.
//
// All logic lives in the pure `$lib/resources/policy` module; this file is
// deliberately just the reactive glue plus persistence.

import {
  freshnessRelaxations,
  normalizeResourceMode,
  resolvePolicy,
  type FreshnessRelaxations,
  type NormalizedResourceMode,
  type OverridableKey,
  type ResolvedResourcePolicy,
  type ResourceOverrides,
  type ResourceProfile,
} from "$lib/resources/policy";
import { app } from "./app.svelte";

class ResourceModeStore {
  /** The validated view of whatever is persisted (junk normalizes away). */
  get mode(): NormalizedResourceMode {
    return normalizeResourceMode(app.settings.resourceMode);
  }

  /** The resolved policy every consumer reads. */
  get policy(): ResolvedResourcePolicy {
    return resolvePolicy(this.mode);
  }

  /** Which surfaces are less fresh than Balanced (drives the hints + their
   *  manual "refresh now" actions). */
  get freshness(): FreshnessRelaxations {
    return freshnessRelaxations(this.policy);
  }

  /** Persist a normalized document (the only writer of `resourceMode`).
   *
   *  The document carries one **derived** field with it: the resolved
   *  orchestration concurrency, for the headless automations runner. That
   *  runner is its own process and runs with the app closed, so it cannot read
   *  this policy — and re-deriving the preset table in Rust would be a second
   *  copy free to disagree with this one. It reads the number instead. */
  #write(next: NormalizedResourceMode): void {
    app.settings.resourceMode = {
      profile: next.profile,
      overrides: { ...next.overrides },
      autoSleep: next.autoSleep,
      schemaVersion: next.schemaVersion,
      resolvedOrchestrationConcurrency: resolvePolicy(next).capabilities.orchestrationConcurrency,
    };
    void app.persistSettings();
  }

  /** Bring the mirrored concurrency in step with the policy — at startup, and
   *  after anything else rewrote the settings document. A no-op when it already
   *  agrees, so it costs nothing on the common path; without it a profile saved
   *  by an older build (or never saved at all) would leave the runner on its
   *  fallback while the app itself dispatches by another number. */
  syncRunnerBudget(): void {
    const want = this.policy.capabilities.orchestrationConcurrency;
    if (app.settings.resourceMode?.resolvedOrchestrationConcurrency === want) return;
    this.#write(this.mode);
  }

  /** Switch preset. Overrides are kept — they are the user's explicit
   *  per-capability choices, which the UI reports as "overridden". */
  setProfile(profile: ResourceProfile): void {
    this.#write({ ...this.mode, profile });
  }

  /** Set one capability override (already-validated values only reach disk). */
  setOverride<K extends OverridableKey>(key: K, value: ResourceOverrides[K]): void {
    const mode = this.mode;
    this.#write({ ...mode, overrides: { ...mode.overrides, [key]: value } });
  }

  /** Back to "use preset" for one capability — the override is deleted, not
   *  overwritten, so nothing lingers. */
  clearOverride(key: OverridableKey): void {
    const mode = this.mode;
    const overrides = { ...mode.overrides };
    delete overrides[key];
    this.#write({ ...mode, overrides });
  }

  /** Reset every override (the profile itself stays). */
  resetOverrides(): void {
    this.#write({ ...this.mode, overrides: {} });
  }

  /** Toggle the workspace auto-sleep feature flag. */
  setAutoSleepFlag(enabled: boolean): void {
    this.#write({ ...this.mode, autoSleep: enabled });
  }
}

/** Singleton resource-mode store shared across the app. */
export const resourceMode = new ResourceModeStore();
