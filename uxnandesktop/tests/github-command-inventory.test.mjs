/**
 * Keeps `github-command-inventory.json` honest against the source it inventories.
 *
 * An inventory that drifts is worse than none — it certifies coverage that no
 * longer exists. So, like the quality matrix, this file is checked structurally:
 * every public gh-backed function in `src-tauri/src/github.rs` must have a row,
 * every row must point at a function that still exists, and every file a row
 * cites as evidence must be present in the repository.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inventory = JSON.parse(
  fs.readFileSync(path.join(ROOT, "tests", "github-command-inventory.json"), "utf8"),
);
const source = fs.readFileSync(path.join(ROOT, "src-tauri", "src", "github.rs"), "utf8");

/** The public async surface of github.rs — every one of these shells out to gh. */
const publicFns = [...source.matchAll(/^pub async fn (\w+)/gm)].map((m) => m[1]);

describe("the GitHub command inventory", () => {
  it("covers every public gh-backed function in github.rs", () => {
    const listed = new Set(inventory.functions.map((f) => f.fn));
    const missing = publicFns.filter((fn) => !listed.has(fn));
    expect(missing, "add a row for each (and say how it is validated)").toEqual([]);
  });

  it("lists no function that no longer exists", () => {
    const real = new Set(publicFns);
    const stale = inventory.functions.map((f) => f.fn).filter((fn) => !real.has(fn));
    expect(stale, "remove rows for functions that left the code").toEqual([]);
  });

  it("classifies every row and states its confirmation and consumer", () => {
    for (const row of inventory.functions) {
      expect(row.kind, row.fn).toMatch(/^(read|mutation)/);
      expect(row.gh, row.fn).toMatch(/^gh /);
      expect(row.confirm?.length, `${row.fn} must state its confirmation (or "none")`).toBeGreaterThan(0);
      expect(row.parser?.length, `${row.fn} must name its parser`).toBeGreaterThan(0);
      expect(row.ui?.length, `${row.fn} must name its UI consumer`).toBeGreaterThan(0);
      expect(row.validation, `${row.fn} must state how it is validated`).toBeTruthy();
    }
  });

  it("cites only evidence files that exist", () => {
    for (const row of inventory.functions) {
      for (const file of [...(row.validation?.contract ?? []), ...(row.validation?.fake ?? [])]) {
        expect(fs.existsSync(path.join(ROOT, file)), `${row.fn} cites missing ${file}`).toBe(true);
      }
    }
  });

  it("every mutation states its live-validation status", () => {
    for (const row of inventory.functions.filter((f) => f.kind === "mutation")) {
      const live = row.validation?.live ?? "";
      expect(
        live.startsWith("github_live_") || live.startsWith("pending:"),
        `${row.fn}: a mutation's live status is either a github_live test or an honest "pending: <cause>" — got ${JSON.stringify(live)}`,
      ).toBe(true);
    }
  });

  it("live test names it cites exist in the live suite", () => {
    const liveSuite = fs.readFileSync(
      path.join(ROOT, "src-tauri", "tests", "github_live.rs"),
      "utf8",
    );
    for (const row of inventory.functions) {
      const live = row.validation?.live ?? "";
      for (const name of live.match(/github_live_\w+/g) ?? []) {
        expect(liveSuite.includes(`async fn ${name}`), `${row.fn} cites unknown live test ${name}`).toBe(
          true,
        );
      }
    }
  });
});
