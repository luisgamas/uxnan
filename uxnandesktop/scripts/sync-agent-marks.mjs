#!/usr/bin/env node
// Copies the repository's agent marks into `static/agents/` before dev and build.
//
// `assets/agents/` at the repository root is the single source of every agent's
// mark — the four drawn SVGs (Claude Code, Codex, OpenClaude, Zero) and the
// vendor favicons vendored as PNGs (`web/scripts/fetch-agent-favicons.mjs`). The
// root READMEs and the site render those same files, so the app keeps no copy in
// git (`static/agents/` is ignored) and never fetches a logo at run time: every
// mark renders offline (`src/lib/agentCatalog.ts` → `agentIconSources`). Run by
// the `predev` / `prebuild` scripts, so `tauri dev` and `tauri build` get it too.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** The marks an app needs: drawn SVGs and vendored PNGs, not the README-only
 *  `-on-dark` variants (the app inverts a monochrome mark itself). */
export function isAppMark(name) {
  return (name.endsWith(".svg") || name.endsWith(".png")) && !name.includes("-on-dark");
}

export function syncAgentMarks(
  source = join(here, "..", "..", "assets", "agents"),
  target = join(here, "..", "static", "agents"),
) {
  if (!existsSync(source)) {
    throw new Error(`missing ${source} — the app needs the repository's assets/agents/ directory`);
  }
  mkdirSync(target, { recursive: true });
  const marks = readdirSync(source).filter(isAppMark);
  for (const mark of marks) cpSync(join(source, mark), join(target, mark));
  return marks;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const marks = syncAgentMarks();
    console.log(`[agent-marks] synced ${marks.length} marks into static/agents/`);
  } catch (err) {
    console.error(`[agent-marks] ${err.message}`);
    process.exit(1);
  }
}
