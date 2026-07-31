/**
 * The matrix has to be true, not aspirational.
 *
 * A coverage table is worth exactly as much as the thing that checks it. Left to
 * prose, it becomes a list of intentions within a release or two — every row
 * ticked, nothing verified. So the matrix is data, and this reads it back
 * against the repository: a flow that claims a layer must point at a file that
 * exists, and a gap must be written down rather than left blank.
 *
 * It deliberately does **not** check that the cited tests pass — that is the
 * suite's job. It checks that the map matches the territory.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(HERE, "..");
const matrix = JSON.parse(fs.readFileSync(path.join(HERE, "quality-matrix.json"), "utf8"));

const LAYERS = ["L1", "L2", "L3", "L4", "L5"];

/** Every path a piece of evidence mentions, split out of its prose. */
function citedPaths(evidence) {
  return String(evidence)
    .split(/[,\s]+/)
    .map((token) => token.replace(/[(),]/g, ""))
    .filter((token) => /^(src|scripts|tests|src-tauri)\//.test(token));
}

/**
 * Does this citation point at something real?
 *
 * A glob is allowed — "src/lib/pets/*.test.ts" is a more honest citation than an
 * arbitrary one of the six files it covers — but it has to *match* something.
 * An empty glob is the same lie as a missing file, just harder to notice.
 */
function citationResolves(cited) {
  const full = path.join(DESKTOP_ROOT, cited);
  if (!cited.includes("*")) return fs.existsSync(full);

  const dir = path.dirname(full);
  if (!fs.existsSync(dir)) return false;
  const pattern = new RegExp(
    `^${path
      .basename(cited)
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")}$`,
  );
  const walk = (root) =>
    fs.readdirSync(root, { withFileTypes: true }).some((entry) => {
      if (entry.isDirectory()) return walk(path.join(root, entry.name));
      return pattern.test(entry.name);
    });
  return walk(dir);
}

describe("the quality matrix", () => {
  it("declares every layer it references", () => {
    for (const layer of Object.keys(matrix.layers)) expect(LAYERS).toContain(layer);
    for (const flow of matrix.flows) {
      for (const layer of [...flow.covered, ...flow.planned]) {
        expect(LAYERS, `${flow.id} references an unknown layer`).toContain(layer);
      }
    }
  });

  it("gives every flow an id, an owner and a platform column", () => {
    const ids = new Set();
    for (const flow of matrix.flows) {
      expect(flow.id, "a flow has no id").toBeTruthy();
      expect(ids.has(flow.id), `duplicate flow id ${flow.id}`).toBe(false);
      ids.add(flow.id);
      expect(flow.owner, `${flow.id} has no owner`).toBeTruthy();
      expect(flow.platforms, `${flow.id} has no platform column`).toBeTruthy();
    }
  });

  it("never lists a layer as both covered and planned", () => {
    // "Done and also to do" is how a matrix stops meaning anything.
    for (const flow of matrix.flows) {
      const both = flow.covered.filter((l) => flow.planned.includes(l));
      expect(both, `${flow.id} lists ${both.join(", ")} as covered *and* planned`).toEqual([]);
    }
  });

  it("backs every claim of coverage with a file that exists", () => {
    const missing = [];
    for (const flow of matrix.flows) {
      for (const layer of flow.covered) {
        const evidence = flow.evidence?.[layer];
        if (!evidence) {
          missing.push(`${flow.id}/${layer}: claims coverage with no evidence`);
          continue;
        }
        for (const cited of citedPaths(evidence)) {
          if (!citationResolves(cited)) {
            missing.push(`${flow.id}/${layer}: ${cited} matches nothing in the repo`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("says what is missing wherever coverage is not complete", () => {
    // A blank `gaps` on a partially covered flow is the quiet lie: it reads as
    // "nothing to see here" when there is.
    for (const flow of matrix.flows) {
      if (flow.planned.length === 0) continue;
      expect(flow.gaps, `${flow.id} has planned layers but no stated gap`).toBeTruthy();
    }
  });

  it("does not claim a platform is verified without saying how", () => {
    for (const flow of matrix.flows) {
      for (const [platform, state] of Object.entries(flow.platforms)) {
        expect(
          typeof state === "string" && state.length > 0,
          `${flow.id}/${platform} has an empty state`,
        ).toBe(true);
      }
    }
  });

  it("covers every flow at at least one layer", () => {
    // A row with no coverage anywhere is a to-do list item, not a matrix entry;
    // it belongs in FOR-DEV.md until something tests it.
    for (const flow of matrix.flows) {
      expect(flow.covered.length, `${flow.id} claims no coverage at all`).toBeGreaterThan(0);
    }
  });
});
