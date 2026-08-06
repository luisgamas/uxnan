// Copies the repository's agent marks into `public/` before dev and build.
//
// `assets/agents/` is the single source of truth — the root READMEs render those
// same files — so the site does not keep its own copy in git (`public/agents/`
// is ignored). Run automatically by the `predev` / `prebuild` scripts.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "..", "assets", "agents");
const target = join(here, "..", "public", "agents");

if (!existsSync(source)) {
  console.error(
    `[agent-marks] missing ${source} — the site needs the repository's assets/agents/ directory.`,
  );
  process.exit(1);
}

mkdirSync(target, { recursive: true });

const marks = readdirSync(source).filter((name) => name.endsWith(".svg"));
for (const mark of marks) {
  cpSync(join(source, mark), join(target, mark));
}

console.log(`[agent-marks] synced ${marks.length} marks into public/agents/`);
