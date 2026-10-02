#!/usr/bin/env node
// The host engine (`uxnan-host`) for every platform the app can put it on, in
// `src-tauri/host-engine/<triple>/uxnan-host`, where the sidecar overlay
// (`src-tauri/tauri.cli.conf.json`) bundles it as a resource.
//
// The app uploads the build that matches a remote host's platform over SFTP
// (`src-tauri/src/ssh/engine.rs`). So, unlike `uxnan-cli`, **every** installer
// carries **every** host build — a Windows laptop can drive a Linux server.
// They are static and small (~1.3 MB each), which is why they are bundled rather
// than downloaded.
//
//   node scripts/build-host-engine.mjs            # make sure the folder exists
//   node scripts/build-host-engine.mjs --build    # build what this machine can
//   node scripts/build-host-engine.mjs --require  # fail unless all are present
//
// No build machine can produce all of them (the Apple ones need macOS), so the
// release builds them on their own runners and hands them to each installer
// leg (`release-desktop.yml` → `host-engine`); this script's `--require` is the
// check that none is missing from what ships. A development build runs it with
// neither flag: whatever is there is bundled, and a host whose platform has no
// build keeps its terminals on plain SSH channels.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tauriDir = join(here, "..", "src-tauri");

/** The platforms the app ships an engine for, and how each is built. */
export const TARGETS = [
  { triple: "x86_64-unknown-linux-musl", builder: "zigbuild" },
  { triple: "aarch64-unknown-linux-musl", builder: "zigbuild" },
  { triple: "aarch64-apple-darwin", builder: "cargo", needs: "darwin" },
  { triple: "x86_64-apple-darwin", builder: "cargo", needs: "darwin" },
];

export function executableName(triple) {
  return triple.includes("windows") ? "uxnan-host.exe" : "uxnan-host";
}

/** Where cargo leaves a build, and where the bundle takes it from. */
export function paths(triple, root = tauriDir) {
  const exe = executableName(triple);
  return {
    built: join(root, "target", triple, "release", exe),
    bundled: join(root, "host-engine", triple, exe),
  };
}

/** The targets whose bundled build is missing. */
export function missing(root = tauriDir, targets = TARGETS) {
  return targets.filter((t) => !existsSync(paths(t.triple, root).bundled)).map((t) => t.triple);
}

/** Whether this machine can build `target`. */
export function canBuild(target, platform = process.platform) {
  return target.needs !== "darwin" || platform === "darwin";
}

function build(target) {
  const args =
    target.builder === "zigbuild"
      ? ["zigbuild", "-p", "uxnan-host", "--release", "--target", target.triple]
      : ["build", "-p", "uxnan-host", "--release", "--target", target.triple];
  console.log(`[host-engine] cargo ${args.join(" ")}`);
  const run = spawnSync("cargo", args, { cwd: tauriDir, stdio: "inherit" });
  if (run.status !== 0) return false;
  const { built, bundled } = paths(target.triple);
  if (!existsSync(built)) return false;
  mkdirSync(dirname(bundled), { recursive: true });
  copyFileSync(built, bundled);
  console.log(`[host-engine] ready: ${bundled}`);
  return true;
}

function main(argv) {
  const dir = join(tauriDir, "host-engine");
  mkdirSync(dir, { recursive: true });
  // Tauri bundles the folder as a resource; it must exist even when empty, and
  // an empty folder is not something git or a fresh checkout keeps.
  writeFileSync(join(dir, ".keep"), "");

  if (argv.includes("--build")) {
    for (const target of TARGETS) {
      if (!canBuild(target)) {
        console.log(`[host-engine] skipping ${target.triple}: needs a ${target.needs} machine`);
        continue;
      }
      if (!build(target)) {
        console.error(`[host-engine] ${target.triple} did not build`);
        process.exit(1);
      }
    }
  }

  const absent = missing();
  if (argv.includes("--require") && absent.length > 0) {
    console.error(`[host-engine] missing from the bundle: ${absent.join(", ")}`);
    process.exit(1);
  }
  if (absent.length > 0) {
    console.log(
      `[host-engine] not bundled: ${absent.join(", ")} — hosts on those platforms keep plain SSH terminals`,
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
