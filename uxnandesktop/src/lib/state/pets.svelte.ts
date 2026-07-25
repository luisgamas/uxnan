// Pets — the library, the active pet, and what each pet is currently reacting to.
//
// The library has two halves that resolve identically:
//   • the bundled pet, read from `static/pets/<id>/pet.json` — uxnan's own
//     artwork, the only pet we ship;
//   • imported pets under `<app-data>/pets/`, listed by the Rust side.
// Both are parsed by `$lib/pets/manifest`, so one renderer serves either.
//
// What a pet *does* comes from the precise hook layer (`agentStatus`), whose
// four states map one-to-one onto the ecosystem's animations. There is exactly
// one pet: when several agents report at once the most urgent state wins.
//
// Spritesheets are fetched lazily and memoized: listing a large library stays
// cheap, and a sheet is only inlined when a pet is actually shown or previewed.

import { petsList, petsSheet, petsImport, petsDelete } from "$lib/api";
import {
  dedupeById,
  defaultAnimations,
  parsePet,
  type Pet,
  type PetFrameSpec,
} from "$lib/pets/manifest";
import { aggregateState, hasDecayed, type PetState } from "$lib/pets/status";
import { agentStatus } from "./agentStatus.svelte";
import { terminals } from "./terminals.svelte";
import { app } from "./app.svelte";
import { clock } from "$lib/time.svelte";

/** Id of the pet bundled with the app (see `static/pets/`). */
export const BUILTIN_PET_ID = "uxni";

/** Hard cap on how old a hook report may be before it is ignored outright,
 *  matching how the sidebar dims a stale report. Individual states decay sooner
 *  — see `STATE_LIFETIME_MS`. */
const STALE_MS = 30 * 60 * 1000;

/** The pet on screen, with the agent it is reflecting. */
export interface PetInstance {
  state: PetState;
  /** Tab to focus when the pet is clicked; `undefined` when nothing to focus. */
  tabId?: string;
  /** Short label (the agent's task) for the tooltip. */
  label?: string;
}

class PetStore {
  /** Every pet available to select, bundled first. */
  library = $state<Pet[]>([]);
  /** Spritesheet URLs by pet id, resolved lazily. */
  private sheets = $state<Record<string, string>>({});
  /** Pet ids whose sheet is currently being fetched (dedupes concurrent asks). */
  private pending = new Set<string>();
  /** True once the library has been loaded at least once. */
  loaded = $state(false);
  /** Last load/import error, surfaced by the Settings section. */
  error = $state("");

  /** The pet the user selected, falling back to the bundled one. */
  get active(): Pet | undefined {
    const id = app.petSettings.activePetId || BUILTIN_PET_ID;
    return this.library.find((p) => p.id === id) ?? this.library[0];
  }

  /** Whether pets should render at all. */
  get enabled(): boolean {
    return app.petSettings.enabled === true;
  }

  /** The spritesheet URL for a pet, or `undefined` until it has been resolved.
   *
   *  Deliberately a **pure read**: components call it from markup, and kicking a
   *  load off from here would mutate `sheets` while a derived/template is being
   *  evaluated — which Svelte 5 rejects with `state_unsafe_mutation`, taking the
   *  whole render down with it. Loading is requested from an `$effect` instead,
   *  via [`ensureSheet`]. */
  sheet(id: string): string | undefined {
    return this.sheets[id];
  }

  /** Ask for a pet's spritesheet to be resolved. Safe to call repeatedly (it
   *  memoizes and de-dupes); call it from an `$effect`, never from markup. */
  async ensureSheet(id: string): Promise<void> {
    await this.loadSheet(id);
  }

  /** Load (and memoize) one pet's spritesheet. Bundled pets are plain static
   *  assets; imported ones are inlined by the backend as data URLs. */
  private async loadSheet(id: string): Promise<void> {
    if (this.sheets[id] !== undefined || this.pending.has(id)) return;
    const pet = this.library.find((p) => p.id === id);
    if (!pet) return;
    this.pending.add(id);
    try {
      const url =
        pet.source === "builtin"
          ? `/pets/${pet.id}/${pet.spritesheetPath}`
          : await petsSheet(id);
      await this.measureSheet(pet, url);
      this.sheets = { ...this.sheets, [id]: url };
    } catch (err) {
      // A pet whose sheet can't be read simply doesn't render; the library entry
      // stays so the user can see it and remove it from Settings.
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.pending.delete(id);
    }
  }

  /**
   * Fill in what a generated pack leaves out: its grid, and its animations.
   *
   * Packs from `hatch-pet` and the community galleries ship only an id, a
   * description and a sheet path — the layout is the format's convention, not
   * per-pack data. So both halves are recovered from the decoded image:
   *
   * • **Grid** — sheets are not all the same height (v2 packs are 11 rows, not
   *   9), and assuming would slice every frame at the wrong offset. Columns and
   *   rows come from the image divided by the conventional cell.
   * • **Animations** — the conventional set for that grid (see
   *   `defaultAnimations`). Without them the renderer falls back to walking the
   *   *entire* sheet, sweeping rows nothing is meant to use.
   *
   * A pack that declares these itself is left alone: it knows better than a
   * convention, and its own `fallback` chains cover any gaps.
   */
  private async measureSheet(pet: Pet, url: string): Promise<void> {
    if (typeof Image === "undefined") return;
    const needsGrid = !pet.frameExplicit;
    const needsAnimations = Object.keys(pet.animations).length === 0;
    if (!needsGrid && !needsAnimations) return;

    try {
      const img = new Image();
      img.src = url;
      await img.decode();

      if (needsGrid) {
        const columns = Math.max(1, Math.round(img.naturalWidth / pet.frame.width));
        const rows = Math.max(1, Math.round(img.naturalHeight / pet.frame.height));
        if (columns !== pet.frame.columns || rows !== pet.frame.rows) {
          pet.frame = { ...pet.frame, columns, rows };
        }
      }
      if (needsAnimations) {
        pet.animations = defaultAnimations(pet.frame.columns, pet.frame.rows);
      }
    } catch {
      // Undecodable (or no canvas) — the conventional grid still renders
      // something, and `resolveAnimation` synthesizes a walk of the sheet.
    }
  }

  /** Load the bundled pet plus every installed one. Safe to call repeatedly —
   *  the Settings section re-runs it after an import or delete. */
  async load(): Promise<void> {
    const library: Pet[] = [];
    // Bundled pet: a static asset, so this works in the browser preview too.
    try {
      const res = await fetch(`/pets/${BUILTIN_PET_ID}/pet.json`);
      if (res.ok) {
        library.push(
          parsePet(await res.json(), BUILTIN_PET_ID, { source: "builtin" }),
        );
      }
    } catch {
      // No bundled pet available (unexpected) — imported pets still work.
    }
    try {
      for (const p of await petsList()) {
        library.push(
          parsePet(p.manifest, p.id, { source: "imported", origin: p.origin, dir: p.dir }),
        );
      }
    } catch {
      // No Tauri backend (web preview): the bundled pet is the whole library.
    }
    // One entry per id: an imported pack may share the bundled pet's id (that is
    // how you replace the mascot), and two entries with the same id break the
    // keyed `{#each}` that renders the library. Imported pets come last, so a
    // deliberate install wins.
    const merged = dedupeById(library);
    // Drop cached sheets for pets that are gone, so a re-imported pet re-reads.
    const ids = new Set(merged.map((p) => p.id));
    for (const id of Object.keys(this.sheets)) {
      if (!ids.has(id)) delete this.sheets[id];
    }
    this.library = merged;
    this.loaded = true;
  }

  /** Import a pet folder and refresh the library. */
  async import(source: string, origin: string, overwrite = false): Promise<boolean> {
    this.error = "";
    try {
      await petsImport(source, origin, overwrite);
      await this.load();
      return true;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  /** Delete an installed pet, clearing the selection if it was the active one. */
  async remove(id: string): Promise<void> {
    this.error = "";
    try {
      await petsDelete(id);
      if (app.petSettings.activePetId === id) app.updatePets({ activePetId: "" });
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  /**
   * When each agent *entered* the state it is currently reporting.
   *
   * Deliberately a plain Map, not reactive state: it is a memo written while
   * deriving, and a `$state` write there is exactly the `state_unsafe_mutation`
   * that takes a render down. Nothing reads it except the derivation that fills
   * it, so it never needs to trigger one.
   */
  private enteredAt = new Map<string, { state: PetState; at: number }>();

  /**
   * Live agent reports still worth showing, paired with their tab.
   *
   * Two filters: a report older than [`STALE_MS`] is ignored outright, and a
   * state that has outlived its own lifetime decays away (a task that has been
   * running for hours stops being news after three minutes — see
   * `STATE_LIFETIME_MS`). The lifetime runs from when the agent *entered* the
   * state, so a hook firing `working` on every tool call cannot keep renewing it.
   */
  private reporting(): { tabId: string; state: PetState; label?: string }[] {
    // Read the shared clock so the derivation re-runs as states age out, rather
    // than only when a new hook report arrives.
    const now = Math.max(clock.now, Date.now());
    const out: { tabId: string; state: PetState; label?: string }[] = [];
    const live = new Set<string>();

    for (const [tabId, report] of Object.entries(agentStatus.byId)) {
      live.add(tabId);
      const seen = this.enteredAt.get(tabId);
      if (!seen || seen.state !== report.status) {
        this.enteredAt.set(tabId, { state: report.status, at: report.lastUpdate });
      }
      const since = this.enteredAt.get(tabId)?.at ?? report.lastUpdate;

      if (now - report.lastUpdate > STALE_MS) continue;
      if (hasDecayed(report.status, since, now)) continue;
      out.push({ tabId, state: report.status, label: report.prompt ?? undefined });
    }
    // Forget tabs that are gone, so the memo can't grow without bound.
    for (const tabId of this.enteredAt.keys()) {
      if (!live.has(tabId)) this.enteredAt.delete(tabId);
    }
    return out;
  }

  /**
   * The pet to render right now, or `null` when pets are off.
   *
   * There is exactly one: several agents collapse into the single most urgent
   * state (needs-you → blocked → ready → working). One pet per agent was tried
   * and dropped — the sidebar already reports each agent precisely, so extra
   * pets duplicated that instead of adding anything, and they only ever appeared
   * during the brief moments two agents worked at once.
   */
  get instance(): PetInstance | null {
    if (!this.enabled) return null;
    const reports = this.reporting();
    const state = aggregateState(reports.map((r) => r.state));
    // Focus target: the agent actually driving the shown state.
    const driver = reports.find((r) => r.state === state);
    return { state, tabId: driver?.tabId, label: driver?.label };
  }

  /** Jump to the terminal whose agent a pet is reflecting. */
  focus(tabId: string | undefined): void {
    if (!tabId) return;
    for (const { tab, workspace } of terminals.tabsWithWorkspace()) {
      if (tab.id === tabId) {
        terminals.revealTab(workspace, tabId);
        return;
      }
    }
  }
}

/** Singleton pets store shared across the app. */
export const pets = new PetStore();
