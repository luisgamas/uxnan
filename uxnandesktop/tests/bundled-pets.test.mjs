/**
 * The pets we ship have to be real, listed, and sliceable.
 *
 * A bundled pet is nothing but a folder in `static/pets/` plus its id in
 * `src/lib/pets/bundled.ts` — no registration, no code. That cheapness is the
 * point, and also the failure mode: art dropped in `static/` without its id in
 * the list is packaged into every build and never shown, and an id listed
 * without its art leaves the library one entry short with only a swallowed
 * fetch to say so.
 *
 * What is enforced here:
 *   - the list and the folders on disk are the same set, so neither half can
 *     drift from the other;
 *   - every pack has a manifest whose `id` matches its folder — the id the
 *     frontend renders is the folder name, so a mismatched manifest silently
 *     contradicts the library;
 *   - `spritesheetPath` is a bare file name (no traversal, no subfolder) that
 *     exists, the same shape `pets.rs` demands of an imported pack;
 *   - the sheet's pixels divide **exactly** into the format's 192 x 208 cell,
 *     because the grid is measured from the image (`measureSheet`) and a sheet
 *     that is off by a pixel slices every frame at the wrong offset;
 *   - a pack declaring `spriteVersionNumber: 2` really is the 8 x 11 v2 sheet
 *     (rows 0-8 animations, rows 9-10 the 16 look poses) it claims to be;
 *   - the sheet stays under the ceiling `pets.rs` enforces on imports, so what
 *     we ship would survive our own validator.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BUILTIN_PET_IDS, DEFAULT_PET_ID } from "../src/lib/pets/bundled.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(HERE, "..");
const PETS_ROOT = path.join(DESKTOP_ROOT, "static", "pets");

/** The format's cell, shared by every pack (`manifest.ts` → `DEFAULT_FRAME`). */
const CELL = { width: 192, height: 208 };
/** v2 sheets are 8 x 11: nine animation rows plus two rows of look poses. */
const V2_GRID = { columns: 8, rows: 11 };
/** `MAX_SHEET_BYTES` in `src-tauri/src/pets.rs`. */
const MAX_SHEET_BYTES = 24 * 1024 * 1024;

const MANIFEST_NAMES = ["pet.json", "avatar.json"];

/** Read an image's pixel size without a decoder dependency: WebP's RIFF header
 *  (all three chunk flavours) and PNG's IHDR are enough for what we ship. */
function imageSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.length >= 24 && buf.toString("ascii", 0, 4) === "\x89PNG") {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length < 30 || buf.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return {
      width: buf.readUIntLE(24, 3) + 1,
      height: buf.readUIntLE(27, 3) + 1,
    };
  }
  if (chunk === "VP8 ") {
    return {
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function manifestOf(id) {
  for (const name of MANIFEST_NAMES) {
    const file = path.join(PETS_ROOT, id, name);
    if (fs.existsSync(file)) return { file, json: JSON.parse(fs.readFileSync(file, "utf8")) };
  }
  return null;
}

const foldersOnDisk = fs
  .readdirSync(PETS_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

describe("bundled pets", () => {
  it("lists exactly the packs that are on disk", () => {
    expect([...BUILTIN_PET_IDS].sort()).toEqual(foldersOnDisk);
  });

  it("has no duplicate ids", () => {
    expect(new Set(BUILTIN_PET_IDS).size).toBe(BUILTIN_PET_IDS.length);
  });

  it("defaults to the first bundled pet", () => {
    expect(DEFAULT_PET_ID).toBe(BUILTIN_PET_IDS[0]);
  });

  it("ships more than one, so the library is a choice", () => {
    expect(BUILTIN_PET_IDS.length).toBeGreaterThan(1);
  });

  describe.each(BUILTIN_PET_IDS)("%s", (id) => {
    it("has a manifest whose id matches its folder", () => {
      const manifest = manifestOf(id);
      expect(manifest, `no pet.json/avatar.json in static/pets/${id}/`).not.toBeNull();
      expect(manifest.json.id).toBe(id);
      expect(typeof manifest.json.displayName).toBe("string");
      expect(manifest.json.displayName.length).toBeGreaterThan(0);
    });

    it("points at a spritesheet that is a bare file name and exists", () => {
      const { json } = manifestOf(id);
      const sheet = json.spritesheetPath ?? "spritesheet.png";
      expect(sheet).toBe(path.basename(sheet));
      const file = path.join(PETS_ROOT, id, sheet);
      expect(fs.existsSync(file), `missing ${file}`).toBe(true);
      expect(fs.statSync(file).size).toBeLessThanOrEqual(MAX_SHEET_BYTES);
    });

    it("has a sheet that divides exactly into the format's cell", () => {
      const { json } = manifestOf(id);
      const size = imageSize(path.join(PETS_ROOT, id, json.spritesheetPath ?? "spritesheet.png"));
      expect(size, "unreadable image header").not.toBeNull();
      expect(size.width % CELL.width).toBe(0);
      expect(size.height % CELL.height).toBe(0);

      if (json.spriteVersionNumber === 2) {
        expect({
          columns: size.width / CELL.width,
          rows: size.height / CELL.height,
        }).toEqual(V2_GRID);
      }
    });
  });
});
