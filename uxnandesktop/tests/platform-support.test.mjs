/**
 * The platform matrix has to be true, not aspirational.
 *
 * `platform-support.json` is the machine-readable source for every platform
 * claim the project makes — the levels, the evidence, the checklists and the
 * `announced` state per platform. Left as prose it would drift within a release;
 * as data it can be read back against the repository, the same posture as
 * `quality-matrix.test.mjs`.
 *
 * What is enforced here:
 *   - only the six agreed levels exist, in their escalating order;
 *   - every cell cites evidence, and every file a citation names exists;
 *   - `smoke` and above additionally record date, sha, hardware and tester —
 *     an unrecorded manual check is indistinguishable from one nobody did;
 *   - a platform's `announced` level never exceeds the weakest of its core
 *     feature cells (announcing more than the evidence is the failure mode this
 *     whole file exists to prevent);
 *   - `signed` / `release-ready` require a signing evidence block;
 *   - a platform still below `release-ready` has a checklist saying how to
 *     advance, and the doc (`docs/platform-support.md`) states each platform's
 *     announced level verbatim, so the human-readable table cannot quietly
 *     disagree with the source.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { gate, levelIndex, renderChecklist } from "../scripts/platform-support.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(DESKTOP_ROOT, "..");
const matrix = JSON.parse(fs.readFileSync(path.join(HERE, "platform-support.json"), "utf8"));

const LEVELS = ["code-only", "builds", "smoke", "validated", "signed", "release-ready"];

/** Every repo path a piece of evidence mentions, split out of its prose.
 *  `.github/…` lives at the repository root; everything else under the
 *  desktop root — same citation style as the quality matrix. */
function citedPaths(evidence) {
  return String(evidence)
    .split(/[,;\s]+/)
    .map((token) => token.replace(/[(),;]/g, "").replace(/\.+$/, ""))
    .filter((token) => /^(src|scripts|tests|src-tauri|docs|\.github)\//.test(token));
}

function citationResolves(cited) {
  const root = cited.startsWith(".github/") ? REPO_ROOT : DESKTOP_ROOT;
  const full = path.join(root, cited);
  if (!cited.includes("*")) return fs.existsSync(full);
  const dir = path.dirname(full);
  if (!fs.existsSync(dir)) return false;
  const pattern = new RegExp(
    `^${path
      .basename(cited)
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")}$`,
  );
  const walk = (root_) =>
    fs.readdirSync(root_, { withFileTypes: true }).some((entry) => {
      if (entry.isDirectory()) return walk(path.join(root_, entry.name));
      return pattern.test(entry.name);
    });
  return walk(dir);
}

const platformIds = Object.keys(matrix.platforms);

describe("the platform support matrix", () => {
  it("declares exactly the agreed levels, in order", () => {
    expect(matrix.levels).toEqual(LEVELS);
  });

  it("gives every platform a name, a minimum version and an announced level", () => {
    for (const [id, platform] of Object.entries(matrix.platforms)) {
      expect(platform.name, `${id} has no name`).toBeTruthy();
      expect(platform.minimum, `${id} has no minimum version`).toBeTruthy();
      expect(LEVELS, `${id} announces an unknown level`).toContain(platform.announced);
    }
  });

  it("keeps every feature cell on a known platform and a known level", () => {
    const ids = new Set();
    for (const feature of matrix.features) {
      expect(feature.id, "a feature has no id").toBeTruthy();
      expect(ids.has(feature.id), `duplicate feature id ${feature.id}`).toBe(false);
      ids.add(feature.id);
      for (const [platform, cell] of Object.entries(feature.status)) {
        expect(platformIds, `${feature.id} cites unknown platform ${platform}`).toContain(platform);
        expect(LEVELS, `${feature.id}/${platform} has an unknown level`).toContain(cell.level);
      }
    }
    for (const core of matrix.coreFeatures) {
      expect(ids.has(core), `core feature ${core} has no row`).toBe(true);
    }
  });

  it("backs every cell with evidence, and every citation with a file that exists", () => {
    const missing = [];
    for (const feature of matrix.features) {
      for (const [platform, cell] of Object.entries(feature.status)) {
        if (!cell.evidence) {
          missing.push(`${feature.id}/${platform}: no evidence`);
          continue;
        }
        for (const cited of citedPaths(cell.evidence)) {
          if (!citationResolves(cited)) {
            missing.push(`${feature.id}/${platform}: ${cited} matches nothing in the repo`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("records date, sha, hardware and tester wherever a run is claimed", () => {
    // `builds` needs a date + sha (a CI run or release is identifiable);
    // `smoke` and above also need the machine and the person.
    const missing = [];
    for (const feature of matrix.features) {
      for (const [platform, cell] of Object.entries(feature.status)) {
        if (levelIndex(cell.level) >= levelIndex("builds")) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(cell.date ?? "")) {
            missing.push(`${feature.id}/${platform}: no ISO date`);
          }
          if (!/^[0-9a-f]{7,40}$/.test(cell.sha ?? "")) {
            missing.push(`${feature.id}/${platform}: no commit sha`);
          }
        }
        if (levelIndex(cell.level) >= levelIndex("smoke")) {
          if (!cell.hardware) missing.push(`${feature.id}/${platform}: no hardware`);
          if (!cell.tester) missing.push(`${feature.id}/${platform}: no tester`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("never announces more than the weakest core feature demonstrates", () => {
    // The release gate proper — also enforced by `scripts/platform-support.mjs
    // gate` in the release workflow; failing here catches it on every PR.
    expect(gate(matrix)).toEqual([]);
  });

  it("requires signing evidence before `signed` is ever announced", () => {
    for (const [id, platform] of Object.entries(matrix.platforms)) {
      if (levelIndex(platform.announced) >= levelIndex("signed")) {
        expect(platform.signing, `${id} announces ${platform.announced} with no signing block`).toBeTruthy();
      }
    }
  });

  it("gives every platform below release-ready a checklist that advances it", () => {
    for (const [id, platform] of Object.entries(matrix.platforms)) {
      if (platform.announced === "release-ready") continue;
      const list = matrix.checklists?.[id] ?? [];
      expect(list.length, `${id} is ${platform.announced} but has no checklist`).toBeGreaterThan(0);
      for (const item of list) {
        expect(LEVELS, `${id}/${item.id} advances to an unknown level`).toContain(item.advancesTo);
        expect(
          levelIndex(item.advancesTo) > levelIndex(platform.announced),
          `${id}/${item.id} advances to ${item.advancesTo}, which ${id} already announces`,
        ).toBe(true);
      }
      // The checklist renderer must be able to produce the release checklist
      // from this source alone (no hand-kept twin to contradict it).
      const rendered = renderChecklist(matrix, id);
      expect(rendered).toContain(platform.announced);
      for (const item of list) expect(rendered).toContain(item.item);
    }
  });

  it("agrees with the human-readable doc about every announced level", () => {
    const doc = fs.readFileSync(path.join(DESKTOP_ROOT, "docs", "platform-support.md"), "utf8");
    for (const [id, platform] of Object.entries(matrix.platforms)) {
      const row = new RegExp(`\\|\\s*\`${id}\`[^\\n]*\`${platform.announced}\``);
      expect(
        row.test(doc),
        `docs/platform-support.md has no summary row stating ${id} = ${platform.announced}`,
      ).toBe(true);
    }
    expect(
      doc.includes(matrix.updated),
      "docs/platform-support.md does not carry the matrix's updated date",
    ).toBe(true);
  });
});
