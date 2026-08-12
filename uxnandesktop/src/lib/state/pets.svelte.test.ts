/**
 * The library half of the pets store: what ships, what is installed, and what
 * happens when one of them can't be read.
 *
 * The bundled pets are static assets rather than a backend call, so they are
 * faked at `fetch` — the same shape the app actually serves from
 * `static/pets/<id>/pet.json`. `tests/bundled-pets.test.mjs` covers the other
 * half of that contract: that those files really exist and really slice.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { installFakeBackend } from "../../test/tauri";
import { BUILTIN_PET_IDS, DEFAULT_PET_ID } from "$lib/pets/bundled";
import { app } from "$lib/state/app.svelte";
import { pets } from "$lib/state/pets.svelte";

/** A manifest as generated packs ship them: id, name, sheet — nothing else. */
function manifestOf(id: string): Record<string, unknown> {
  return {
    id,
    displayName: id.toUpperCase(),
    spriteVersionNumber: 2,
    spritesheetPath: "spritesheet.webp",
  };
}

/** Serve `static/pets/<id>/pet.json` for every bundled id, minus `missing`. */
function stubStaticPets(missing: readonly string[] = []): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const id = BUILTIN_PET_IDS.find((candidate) => url === `/pets/${candidate}/pet.json`);
      if (!id || missing.includes(id)) {
        return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => manifestOf(id) } as unknown as Response;
    }),
  );
}

beforeEach(() => {
  pets.library = [];
  pets.loaded = false;
  pets.error = "";
  app.settings.pets = {};
  vi.unstubAllGlobals();
});

describe("pets library", () => {
  it("loads every bundled pet, in the order they are declared", async () => {
    stubStaticPets();
    installFakeBackend({ pets_list: () => [] });

    await pets.load();

    expect(pets.library.map((p) => p.id)).toEqual([...BUILTIN_PET_IDS]);
    expect(pets.library.every((p) => p.source === "builtin")).toBe(true);
    expect(pets.loaded).toBe(true);
  });

  it("shows the rest when one bundled manifest can't be read", async () => {
    // One unreadable pack used to be the whole `try` block: a single failure
    // left the library with no bundled pets at all.
    const [first, ...rest] = BUILTIN_PET_IDS;
    stubStaticPets([first]);
    installFakeBackend({ pets_list: () => [] });

    await pets.load();

    expect(pets.library.map((p) => p.id)).toEqual(rest);
  });

  it("rests on the default pet until the user picks another", async () => {
    stubStaticPets();
    installFakeBackend({ pets_list: () => [] });

    await pets.load();
    expect(pets.active?.id).toBe(DEFAULT_PET_ID);

    app.settings.pets = { activePetId: BUILTIN_PET_IDS[BUILTIN_PET_IDS.length - 1] };
    expect(pets.active?.id).toBe(BUILTIN_PET_IDS[BUILTIN_PET_IDS.length - 1]);
  });

  it("lets an imported pack replace the bundled pet it shares an id with", async () => {
    stubStaticPets();
    installFakeBackend({
      pets_list: () => [
        {
          id: DEFAULT_PET_ID,
          manifest: { ...manifestOf(DEFAULT_PET_ID), displayName: "Mine" },
          origin: "Imported from a folder",
          dir: `C:/data/pets/${DEFAULT_PET_ID}`,
        },
      ],
    });

    await pets.load();

    // One entry per id — a duplicate key would take the whole Pets screen down.
    expect(pets.library.map((p) => p.id)).toEqual([...BUILTIN_PET_IDS]);
    const replaced = pets.library.find((p) => p.id === DEFAULT_PET_ID);
    expect(replaced?.source).toBe("imported");
    expect(replaced?.displayName).toBe("Mine");
  });

  it("keeps the bundled pets when the backend isn't there (browser preview)", async () => {
    stubStaticPets();
    installFakeBackend({
      pets_list: () => {
        throw new Error("no backend");
      },
    });

    await pets.load();

    expect(pets.library.map((p) => p.id)).toEqual([...BUILTIN_PET_IDS]);
  });
});
