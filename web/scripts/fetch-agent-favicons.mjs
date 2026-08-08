// Fetches each agent's favicon once, into `assets/agents/` as a PNG.
//
// Why vendored rather than hot-linked: the READMEs and the site both render
// these, and a remote `<img>` on the site would make every visitor's browser
// call a third party just to draw a 40px logo. A file in the repo is also the
// only version that survives the service changing its URL shape.
//
// Only the four agents in `HAND_MADE` keep a drawn mark; everything else uses
// its favicon, which is also what the desktop app itself shows, so the READMEs,
// the site and the running app agree. Run it by hand when adding an agent:
//
//   node web/scripts/fetch-agent-favicons.mjs
//
// It reports what it wrote, what it skipped, and — importantly — which domains
// answered with the service's generic globe, because those are the ones that
// need a hand-made mark instead of a silent grey circle.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, "..", "..", "assets", "agents");
const catalog = join(
  here,
  "..",
  "..",
  "uxnandesktop",
  "src",
  "lib",
  "agentCatalog.ts",
);

/** Every `{ id, favicon }` pair the desktop catalog declares. */
function catalogEntries() {
  const src = readFileSync(catalog, "utf8");
  const out = [];
  for (const m of src.matchAll(
    /\{ id: "([a-z]+)",[^}]*?favicon: "([^"]+)"/g,
  )) {
    out.push({ id: m[1], domain: m[2] });
  }
  return out;
}

/**
 * The only agents that keep a drawn mark. Everything else uses its favicon —
 * the desktop app does the same, so what the site shows is what the app shows.
 * Kept because these are the marks the project leans on the most and a favicon
 * would be a downgrade for them.
 */
const HAND_MADE = new Set(["claudecode", "codex", "openclaude", "zero"]);

const size = 128; // drawn at 40px, so 128 keeps it crisp on a 2x display

mkdirSync(assets, { recursive: true });
const written = [];
const skipped = [];
const generic = [];
const failed = [];
const seen = new Map();

for (const { id, domain } of catalogEntries()) {
  if (HAND_MADE.has(id)) {
    skipped.push(id);
    continue;
  }
  const url = `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const hash = createHash("sha256").update(bytes).digest("hex");
    // The service answers an unknown domain with one fixed globe image, so two
    // agents hashing alike means at least one of them has no real favicon.
    if (seen.has(hash)) generic.push(`${id} (same image as ${seen.get(hash)})`);
    seen.set(hash, id);
    writeFileSync(join(assets, `${id}.png`), bytes);
    written.push(id);
  } catch (err) {
    failed.push(`${id}: ${err.message}`);
  }
}

console.log(`[favicons] wrote ${written.length}: ${written.join(", ")}`);
if (skipped.length) {
  console.log(`[favicons] kept hand-made marks for: ${skipped.join(", ")}`);
}
if (generic.length) {
  console.log(`[favicons] LOOK: identical images (likely the generic globe):`);
  for (const g of generic) console.log(`  - ${g}`);
}
if (failed.length) {
  console.log(`[favicons] failed:`);
  for (const f of failed) console.log(`  - ${f}`);
}
