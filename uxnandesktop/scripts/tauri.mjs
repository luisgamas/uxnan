#!/usr/bin/env node
// `npm run tauri …` — the Tauri CLI, with the sidecar overlay applied to the
// two commands that produce a runnable app.
//
// `uxnan-cli` ships inside the app as a Tauri sidecar (`bundle.externalBin`).
// Tauri validates a sidecar's file on **every** `cargo build` of the app —
// `cargo test`, `cargo clippy`, an editor's check — so declaring it in
// `tauri.conf.json` would make each of those fail until someone builds the
// CLI first. It lives instead in `src-tauri/tauri.cli.conf.json`, an overlay
// this wrapper passes to `tauri dev` and `tauri build` (the overlay also builds
// the CLI in its before-commands). Everything else — `tauri info`, `icon`,
// `build --no-bundle` for the benchmarks — runs the CLI as is.
//
// tauri-action in `release-desktop.yml` runs this same `tauri` script, so the
// installers carry the sidecar without a workflow-side flag.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/** The argv to hand the Tauri CLI: the overlay slipped in after `dev`/`build`. */
export function withOverlay(args) {
  const [command, ...rest] = args;
  if (command !== "dev" && command !== "build") return args;
  if (rest.includes("--no-bundle")) return args;
  return [command, "--config", "src-tauri/tauri.cli.conf.json", ...rest];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const bin = join(root, "node_modules", ".bin", process.platform === "win32" ? "tauri.cmd" : "tauri");
  const result = spawnSync(bin, withOverlay(process.argv.slice(2)), {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  process.exit(result.status ?? 1);
}
