#!/usr/bin/env node
/**
 * Read `tests/platform-support.json` — the machine-readable source for every
 * platform claim — and answer two questions from it:
 *
 *   node scripts/platform-support.mjs checklist [platform]
 *     Render the release checklist for one platform (or all of them): the
 *     announced level, the evidence gaps, and the recorded manual steps that
 *     advance it. Generated from the source so no hand-kept table can
 *     contradict it.
 *
 *   node scripts/platform-support.mjs gate
 *     Exit non-zero if any platform announces a state its evidence does not
 *     support. Run by the release workflow before installers are built, and by
 *     `tests/platform-support.test.mjs` on every PR. Pure Node, no deps — the
 *     release job can run it before `npm ci`.
 *
 * The structural shape of the file (levels, required fields, citations) is
 * verified by the test; the gate re-checks only the claims-vs-evidence rule so
 * a stale checkout can never publish an overstated platform.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MATRIX_PATH = path.join(HERE, "..", "tests", "platform-support.json");

/** The escalating levels; index = strength. */
export const LEVELS = ["code-only", "builds", "smoke", "validated", "signed", "release-ready"];

/** Position of a level in the ladder; -1 for an unknown level (which the
 *  structural test rejects — the gate treats it as "no evidence"). */
export function levelIndex(level) {
  return LEVELS.indexOf(level);
}

/** The strongest level a platform may announce: the weakest of its core
 *  feature cells. A platform missing a core row supports nothing. */
export function maxAnnouncable(matrix, platformId) {
  let weakest = LEVELS.length - 1;
  for (const featureId of matrix.coreFeatures) {
    const feature = matrix.features.find((f) => f.id === featureId);
    const cell = feature?.status?.[platformId];
    if (!cell) return -1;
    weakest = Math.min(weakest, levelIndex(cell.level));
  }
  return weakest;
}

/**
 * Every claims-vs-evidence violation in the matrix, as human-readable strings.
 * Empty means the announced states are honest.
 */
export function gate(matrix) {
  const problems = [];
  for (const [id, platform] of Object.entries(matrix.platforms)) {
    const announced = levelIndex(platform.announced);
    if (announced < 0) {
      problems.push(`${id}: announces unknown level '${platform.announced}'`);
      continue;
    }
    const supported = maxAnnouncable(matrix, id);
    if (supported < 0) {
      problems.push(`${id}: has no cell for at least one core feature`);
      continue;
    }
    if (announced > supported) {
      problems.push(
        `${id}: announces '${platform.announced}' but its weakest core feature only demonstrates '${LEVELS[supported]}'`,
      );
    }
    if (announced >= levelIndex("signed") && !platform.signing) {
      problems.push(`${id}: announces '${platform.announced}' with no signing evidence block`);
    }
  }
  return problems;
}

/** Render one platform's release checklist from the source. */
export function renderChecklist(matrix, platformId) {
  const platform = matrix.platforms[platformId];
  if (!platform) return `unknown platform '${platformId}'`;
  const lines = [];
  lines.push(`${platform.name} (${platformId})`);
  lines.push(`  announced level : ${platform.announced}`);
  lines.push(`  minimum version : ${platform.minimum}`);
  if (platform.notes) lines.push(`  notes           : ${platform.notes}`);
  lines.push("  core feature evidence:");
  for (const featureId of matrix.coreFeatures) {
    const feature = matrix.features.find((f) => f.id === featureId);
    const cell = feature?.status?.[platformId];
    if (!cell) {
      lines.push(`    - ${featureId}: MISSING`);
      continue;
    }
    lines.push(`    - ${featureId}: ${cell.level} (${cell.date ?? "no date"}, ${cell.sha ?? "no sha"})`);
    if (cell.gaps) lines.push(`        gap: ${cell.gaps}`);
  }
  const list = matrix.checklists?.[platformId] ?? [];
  if (list.length > 0) {
    lines.push("  to advance:");
    for (const item of list) {
      lines.push(`    [ ] (${item.advancesTo}) ${item.item}`);
    }
  } else if (platform.announced !== "release-ready") {
    lines.push("  to advance: NO CHECKLIST RECORDED — that is a matrix bug.");
  }
  return lines.join("\n");
}

function main() {
  const matrix = JSON.parse(fs.readFileSync(MATRIX_PATH, "utf8"));
  const [, , command, arg] = process.argv;

  if (command === "gate") {
    const problems = gate(matrix);
    if (problems.length > 0) {
      for (const p of problems) console.error(`platform-support gate: ${p}`);
      console.error(
        "Refusing: an announced platform state exceeds its recorded evidence. " +
          "Either add the evidence to tests/platform-support.json or degrade the announced level.",
      );
      process.exit(1);
    }
    console.log(
      `platform-support gate: ${Object.keys(matrix.platforms).length} platform(s) announce no more than their evidence (updated ${matrix.updated}).`,
    );
    return;
  }

  if (command === "checklist") {
    const ids = arg ? [arg] : Object.keys(matrix.platforms);
    console.log(ids.map((id) => renderChecklist(matrix, id)).join("\n\n"));
    return;
  }

  console.error("Usage: node scripts/platform-support.mjs <gate | checklist [platform]>");
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
