#!/usr/bin/env node
// Build `uxnan-cli` as the app's sidecar, where Tauri's `bundle.externalBin`
// expects it: `src-tauri/binaries/uxnan-cli-<target triple>[.exe]`.
//
// Run by the sidecar overlay (`src-tauri/tauri.cli.conf.json`) before
// `tauri dev` and `tauri build`, so every bundle — and the dev app — carries the
// console client next to the main executable, and the app can put it on the
// PATH of every terminal it opens. The triple is the one Tauri hands its
// before-commands (`TAURI_ENV_TARGET_TRIPLE`, which follows `--target`), or
// the host's when run by hand.
//
// A release build of the CLI crate alone: it shares the workspace's target
// directory, so an app build that already compiled the shared dependencies pays
// only for the CLI itself.

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tauriDir = join(here, "..", "src-tauri");

/** The target triple: Tauri's, else the host's (`rustc -vV` → `host: …`). */
export function targetTriple(env = process.env) {
  const fromTauri = env.TAURI_ENV_TARGET_TRIPLE?.trim();
  if (fromTauri) return fromTauri;
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const host = out.split("\n").find((l) => l.startsWith("host:"));
  if (!host) throw new Error("rustc -vV printed no host triple");
  return host.slice("host:".length).trim();
}

/** Where cargo leaves the binary, and where Tauri wants it. */
export function paths(triple) {
  const exe = triple.includes("windows") ? ".exe" : "";
  return {
    built: join(tauriDir, "target", triple, "release", `uxnan-cli${exe}`),
    sidecar: join(tauriDir, "binaries", `uxnan-cli-${triple}${exe}`),
  };
}

function main() {
  const triple = targetTriple();
  const { built, sidecar } = paths(triple);
  console.log(`[build-cli] cargo build -p uxnan-cli --release --target ${triple}`);
  const cargo = spawnSync(
    "cargo",
    ["build", "-p", "uxnan-cli", "--release", "--target", triple],
    { cwd: tauriDir, stdio: "inherit" },
  );
  if (cargo.status !== 0) {
    console.error(`[build-cli] cargo exited with ${cargo.status ?? cargo.signal}`);
    process.exit(cargo.status ?? 1);
  }
  if (!existsSync(built)) {
    console.error(`[build-cli] expected ${built} after the build; not there`);
    process.exit(1);
  }
  mkdirSync(dirname(sidecar), { recursive: true });
  copyFileSync(built, sidecar);
  console.log(`[build-cli] sidecar ready: ${sidecar}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
