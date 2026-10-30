#!/usr/bin/env node
// The bridge runtime Uxnan Desktop ships, in `src-tauri/bridge-runtime/`,
// where the sidecar overlay (`src-tauri/tauri.cli.conf.json`) bundles it as a
// resource: the official Node.js binary for the installer's platform plus the
// production tree of `uxnan-bridge` built from this same commit, so the app
// runs a bridge on a machine that has no Node at all
// (`docs/bridge-runtime.md`, architecture/02a §5.8.18).
//
//   node scripts/build-bridge-runtime.mjs                     # make sure the folder exists
//   node scripts/build-bridge-runtime.mjs --build [--target <triple>]
//                                                             # assemble it (this machine's triple by default)
//   node scripts/build-bridge-runtime.mjs --require [--target <triple>]
//                                                             # fail unless a complete runtime for it is there
//
// `--build` needs the monorepo's workspaces built first (`npm ci && npm run
// build` at the repository root): the bridge is packed from them, never
// fetched from npm, so the runtime is exactly the code of the commit the
// installer is built from.
//
// Node is downloaded from nodejs.org and checked against the SHA-256 pinned
// in `NODE` below — never against a checksum file fetched next to it. The
// bridge's dependencies resolve to the versions the root `package-lock.json`
// pins (as npm `overrides`), are installed without running any package
// script, and every file of the result is hashed into `uxnan-runtime.json`,
// which the app checks when it copies the runtime out of the installer.
//
// A development build runs this with no flag: the folder exists but is empty,
// and the app says it carries no bridge (`bridgeclient::runtime`).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tauriDir = join(here, "..", "src-tauri");
const repoRoot = join(here, "..", "..");

/** The Node release every runtime carries (active LTS, "Krypton"). */
export const NODE_VERSION = "24.22.2";

/**
 * Per installer triple: the Node distribution, its pinned SHA-256 (from
 * https://nodejs.org/dist/v24.22.2/SHASUMS256.txt, reviewed when the version
 * moves) and what npm must resolve native packages for.
 */
export const NODE = {
  "aarch64-apple-darwin": {
    dist: "darwin-arm64",
    archive: "tar.xz",
    sha256: "1f5ac075be50bed4780ea3be19a007fda95ea4d527d28d76d0b91de47d915115",
    os: "darwin",
    cpu: "arm64",
    keyring: "@napi-rs/keyring-darwin-arm64",
  },
  "x86_64-apple-darwin": {
    dist: "darwin-x64",
    archive: "tar.xz",
    sha256: "6965578fd823e72c1b5387f5ab84cb25368f886e02eb8779e6f0fce6b91c27b7",
    os: "darwin",
    cpu: "x64",
    keyring: "@napi-rs/keyring-darwin-x64",
  },
  "x86_64-unknown-linux-gnu": {
    dist: "linux-x64",
    archive: "tar.xz",
    sha256: "48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75",
    os: "linux",
    cpu: "x64",
    libc: "glibc",
    keyring: "@napi-rs/keyring-linux-x64-gnu",
  },
  "aarch64-unknown-linux-gnu": {
    dist: "linux-arm64",
    archive: "tar.xz",
    sha256: "eb187837a2230d4047161ac0be008584e16b46f726e9c9490ee35dc6b17d9ba8",
    os: "linux",
    cpu: "arm64",
    libc: "glibc",
    keyring: "@napi-rs/keyring-linux-arm64-gnu",
  },
  "x86_64-pc-windows-msvc": {
    dist: "win-x64",
    archive: "zip",
    sha256: "ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2",
    os: "win32",
    cpu: "x64",
    keyring: "@napi-rs/keyring-win32-x64-msvc",
  },
  "aarch64-pc-windows-msvc": {
    dist: "win-arm64",
    archive: "zip",
    sha256: "f47968c213105077f64c6510f007632c0ca2574802a0b5067c327c49abe1c468",
    os: "win32",
    cpu: "arm64",
    keyring: "@napi-rs/keyring-win32-arm64-msvc",
  },
};

/** The manifest's file name (`RUNTIME_MANIFEST` in `bridge/src/install-kind.ts`). */
export const MANIFEST = "uxnan-runtime.json";

/** Where the bundle takes the runtime from. */
export const outDir = (root = tauriDir) => join(root, "bridge-runtime");

/** The triple of the machine running this script. */
export function hostTriple(platform = process.platform, arch = process.arch) {
  const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : null;
  if (!cpu) return null;
  if (platform === "darwin") return `${cpu}-apple-darwin`;
  if (platform === "linux") return `${cpu}-unknown-linux-gnu`;
  if (platform === "win32") return `${cpu}-pc-windows-msvc`;
  return null;
}

/** `--target <triple>`, or this machine's. An unknown triple is an error. */
export function targetOf(argv, platform = process.platform, arch = process.arch) {
  const at = argv.indexOf("--target");
  const triple = at >= 0 ? argv[at + 1] : hostTriple(platform, arch);
  if (!triple || !NODE[triple]) {
    throw new Error(`no bridge runtime for target ${triple ?? `${platform}-${arch}`}`);
  }
  return triple;
}

/** Where the Node executable and the bridge CLI sit inside a runtime. */
export function layoutFor(triple) {
  const windows = NODE[triple].os === "win32";
  return {
    node: windows ? "node/node.exe" : "node/bin/node",
    cli: "app/node_modules/uxnan-bridge/dist/src/cli.js",
  };
}

/**
 * The production closure of `uxnan-bridge` as the root lockfile resolves it:
 * `name → version` for every package the bridge needs at runtime, found the
 * way Node finds them (nested first, then up). Workspace links are skipped
 * (they are packed from source); a name the closure reaches at two versions
 * is left out, so pinning it cannot force one onto the other. Pure.
 */
export function lockedClosure(lock, roots = ["bridge", "shared"]) {
  const packages = lock.packages ?? {};
  const versions = new Map();
  const conflicted = new Set();
  const seen = new Set();
  const resolve = (from, name) => {
    let base = from;
    for (;;) {
      const key = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
      if (packages[key]) return key;
      if (!base) return null;
      const cut = base.lastIndexOf("/node_modules/");
      base = cut >= 0 ? base.slice(0, cut) : "";
    }
  };
  const walk = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const entry = packages[key];
    if (!entry) return;
    if (key.includes("node_modules/") && !entry.link) {
      const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
      const known = versions.get(name);
      if (known !== undefined && known !== entry.version) conflicted.add(name);
      else versions.set(name, entry.version);
    }
    const target = entry.link ? entry.resolved : key;
    for (const dep of Object.keys(entry.dependencies ?? {})) {
      const found = resolve(target, dep);
      if (found) walk(found);
    }
  };
  for (const root of roots) walk(root);
  for (const name of conflicted) versions.delete(name);
  // Packed from this commit, never pinned to a registry version.
  versions.delete("@uxnan/shared");
  versions.delete("uxnan-bridge");
  return Object.fromEntries([...versions].sort(([a], [b]) => a.localeCompare(b)));
}

/** The staging `package.json` npm installs the runtime from. Pure. */
export function stagingPackage({ sharedTgz, bridgeTgz, keyringVersion, pins }) {
  const direct = {
    "@uxnan/shared": `file:${sharedTgz}`,
    "uxnan-bridge": `file:${bridgeTgz}`,
    // The OS keychain the bridge keeps its identity in: an optional
    // dependency of the bridge (so `--omit=optional` drops it) that the
    // runtime must have. Its native build for the target is added after the
    // install (`addPlatformPackage`): npm refuses to install a package for
    // another CPU even with `--cpu`, and the Intel DMG is built on Apple
    // Silicon.
    "@napi-rs/keyring": keyringVersion,
  };
  const overrides = Object.fromEntries(Object.entries(pins).filter(([name]) => !(name in direct)));
  return { name: "uxnan-bridge-runtime", private: true, dependencies: direct, overrides };
}

/** Every file under `dir`, as forward-slash paths relative to it. Refuses a
 *  symbolic link: a resource tree must be plain files on every platform. */
export function listFiles(dir) {
  const out = [];
  const visit = (abs) => {
    for (const entry of readdirSync(abs).sort()) {
      const path = join(abs, entry);
      const info = lstatSync(path);
      if (info.isSymbolicLink()) throw new Error(`symbolic link in the runtime: ${relative(dir, path)}`);
      if (info.isDirectory()) visit(path);
      else out.push(relative(dir, path).split(sep).join("/"));
    }
  };
  visit(dir);
  return out;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** The manifest for the runtime assembled in `dir`. */
export function buildManifest(dir, { triple, bridgeVersion, nodeVersion = NODE_VERSION }) {
  const layout = layoutFor(triple);
  const files = listFiles(dir)
    .filter((file) => file !== MANIFEST)
    .map((file) => {
      const abs = join(dir, file);
      const info = statSync(abs);
      return {
        path: file,
        size: info.size,
        sha256: sha256File(abs),
        ...(file === layout.node && NODE[triple].os !== "win32" ? { executable: true } : {}),
      };
    });
  return {
    kind: "bundled",
    bridgeVersion,
    nodeVersion,
    triple,
    node: layout.node,
    cli: layout.cli,
    files,
  };
}

/** Problems with the runtime in `dir` for `triple`; empty when complete. */
export function verify(dir, triple) {
  const problems = [];
  const file = join(dir, MANIFEST);
  if (!existsSync(file)) return [`${MANIFEST} is missing`];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [`${MANIFEST} is not JSON`];
  }
  if (manifest.kind !== "bundled") problems.push("not a bundled runtime manifest");
  if (manifest.triple !== triple) problems.push(`built for ${manifest.triple}, not ${triple}`);
  const listed = new Set();
  for (const entry of manifest.files ?? []) {
    listed.add(entry.path);
    const abs = join(dir, entry.path);
    if (!existsSync(abs)) problems.push(`missing ${entry.path}`);
    else if (sha256File(abs) !== entry.sha256) problems.push(`changed ${entry.path}`);
  }
  for (const needed of [manifest.node, manifest.cli]) {
    if (!needed || !listed.has(needed)) problems.push(`the manifest does not list ${needed}`);
  }
  return problems;
}

async function sha256Stream(path) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(path).on("data", (c) => hash.update(c)).on("end", resolve).on("error", reject);
  });
  return hash.digest("hex");
}

/** The Node archive for `triple`, downloaded once into `cacheDir` and
 *  checked against its pinned SHA-256. */
async function nodeArchive(triple, cacheDir) {
  const spec = NODE[triple];
  const name = `node-v${NODE_VERSION}-${spec.dist}.${spec.archive}`;
  const path = join(cacheDir, name);
  if (!existsSync(path) || (await sha256Stream(path)) !== spec.sha256) {
    mkdirSync(cacheDir, { recursive: true });
    const url = `https://nodejs.org/dist/v${NODE_VERSION}/${name}`;
    console.log(`[bridge-runtime] downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  }
  const actual = await sha256Stream(path);
  if (actual !== spec.sha256) {
    rmSync(path, { force: true });
    throw new Error(`${name}: SHA-256 ${actual} is not the pinned ${spec.sha256}`);
  }
  return { path, name };
}

/**
 * The `tar` that can unpack Node's archives here. On Windows that is the
 * system's own bsdtar (`%SystemRoot%\System32\tar.exe`), which reads zip and
 * takes drive-letter paths: the GNU tar Git for Windows puts first on a bash
 * step's PATH reads `D:\…` as a remote host ("Cannot connect to D") and
 * cannot open a zip at all. Pure but for `exists`.
 */
export function tarCommand(platform = process.platform, env = process.env, exists = existsSync) {
  if (platform !== "win32") return "tar";
  const system = join(env.SystemRoot ?? env.windir ?? "C:\\Windows", "System32", "tar.exe");
  return exists(system) ? system : "tar";
}

/** Where a package lives under `node_modules`, as path segments. Pure. */
export function packageDir(name) {
  return ["node_modules", ...name.split("/")];
}

/** Put the target's native build of a package into the installed tree from its
 *  published tarball — the one step npm will not do for another CPU. */
function addPlatformPackage(app, name, version, packs) {
  run("npm", ["pack", `${name}@${version}`, "--pack-destination", packs, "--silent"], { cwd: packs });
  const scoped = name.replace(/^@/, "").replace("/", "-");
  const tgz = readdirSync(packs).find((f) => f.startsWith(`${scoped}-${version}`) && f.endsWith(".tgz"));
  if (!tgz) throw new Error(`npm pack left no tarball for ${name}@${version}`);
  const dest = join(app, ...packageDir(name));
  mkdirSync(dest, { recursive: true });
  run(tarCommand(), ["-xzf", join(packs, tgz), "-C", dest, "--strip-components=1"]);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32" && command === "npm",
    ...options,
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
  return result;
}

async function build(triple) {
  const spec = NODE[triple];
  const bridgeDist = join(repoRoot, "bridge", "dist", "src", "cli.js");
  if (!existsSync(bridgeDist) || !existsSync(join(repoRoot, "shared", "dist"))) {
    throw new Error("build the workspaces first: `npm ci && npm run build` at the repository root");
  }
  const lock = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8"));
  const keyringVersion = lock.packages?.["node_modules/@napi-rs/keyring"]?.version;
  if (!keyringVersion) throw new Error("@napi-rs/keyring is not in the root lockfile");
  const bridgeVersion = JSON.parse(readFileSync(join(repoRoot, "bridge", "package.json"), "utf8")).version;

  const work = mkdtempSync(join(tmpdir(), "uxnan-bridge-runtime-"));
  try {
    // 1. Node, verified.
    const archive = await nodeArchive(triple, join(tauriDir, "target", "bridge-runtime-cache"));
    const stage = join(work, "runtime");
    const layout = layoutFor(triple);
    const top = `node-v${NODE_VERSION}-${spec.dist}`;
    const inner = spec.os === "win32" ? `${top}/node.exe` : `${top}/bin/node`;
    const extract = join(work, "extract");
    mkdirSync(extract, { recursive: true });
    run(tarCommand(), ["-xf", archive.path, "-C", extract, inner, `${top}/LICENSE`]);
    mkdirSync(join(stage, dirname(layout.node)), { recursive: true });
    copyFileSync(join(extract, inner), join(stage, layout.node));
    copyFileSync(join(extract, top, "LICENSE"), join(stage, "node", "LICENSE"));
    if (spec.os !== "win32") chmodSync(join(stage, layout.node), 0o755);

    // 2. The bridge from this commit, with its locked production closure.
    const packs = join(work, "packs");
    mkdirSync(packs, { recursive: true });
    run("npm", ["pack", "-w", "@uxnan/shared", "-w", "uxnan-bridge", "--pack-destination", packs, "--silent"], {
      cwd: repoRoot,
    });
    const tgz = readdirSync(packs);
    const sharedTgz = tgz.find((f) => f.startsWith("uxnan-shared-"));
    const bridgeTgz = tgz.find((f) => f.startsWith("uxnan-bridge-"));
    if (!sharedTgz || !bridgeTgz) throw new Error(`npm pack left ${tgz.join(", ")}`);
    const app = join(stage, "app");
    mkdirSync(app, { recursive: true });
    const pkg = stagingPackage({
      sharedTgz: join(packs, sharedTgz).split(sep).join("/"),
      bridgeTgz: join(packs, bridgeTgz).split(sep).join("/"),
      keyringVersion,
      pins: lockedClosure(lock),
    });
    writeFileSync(join(app, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
    const platformFlags = ["--os", spec.os, "--cpu", spec.cpu, ...(spec.libc ? ["--libc", spec.libc] : [])];
    run(
      "npm",
      [
        "install",
        "--omit=dev",
        // `firebase-admin` (optional, ~66 MB) stays out by decision: push moves
        // to FCM's HTTP v1 API for every bridge (bridge/FOR-DEV.md →
        // *Transport & connectivity*).
        "--omit=optional",
        "--ignore-scripts",
        "--no-package-lock",
        "--no-audit",
        "--no-fund",
        "--no-bin-links",
        ...platformFlags,
      ],
      { cwd: app },
    );
    addPlatformPackage(app, spec.keyring, keyringVersion, packs);
    // What only npm needed: the file references would point at this machine's
    // temp folder, and the hidden lock is npm's own cache of the tree.
    rmSync(join(app, "package.json"));
    rmSync(join(app, "node_modules", ".package-lock.json"), { force: true });
    rmSync(join(app, "node_modules", ".bin"), { recursive: true, force: true });

    // 3. The manifest, over every file.
    const manifest = buildManifest(stage, { triple, bridgeVersion });
    writeFileSync(join(stage, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    const problems = verify(stage, triple);
    if (problems.length > 0) throw new Error(`the runtime does not verify: ${problems.join("; ")}`);

    // 4. Swap it in.
    const out = outDir();
    rmSync(out, { recursive: true, force: true });
    mkdirSync(dirname(out), { recursive: true });
    try {
      renameSync(stage, out);
    } catch {
      cpSync(stage, out, { recursive: true });
    }
    const bytes = manifest.files.reduce((sum, f) => sum + f.size, 0);
    console.log(
      `[bridge-runtime] ready: ${out} — bridge ${bridgeVersion}, node ${NODE_VERSION}, ${triple}, ` +
        `${manifest.files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Whether `dir` holds a runtime at all (anything but the placeholder). */
export function present(dir = outDir()) {
  return existsSync(join(dir, MANIFEST));
}

async function main(argv) {
  const dir = outDir();
  mkdirSync(dir, { recursive: true });
  // Tauri bundles the folder as a resource; it must exist even when empty.
  if (!present(dir)) writeFileSync(join(dir, ".keep"), "");

  const triple = targetOf(argv);
  if (argv.includes("--build")) await build(triple);

  if (argv.includes("--require")) {
    const problems = verify(dir, triple);
    if (problems.length > 0) {
      console.error(`[bridge-runtime] not shippable for ${triple}: ${problems.join("; ")}`);
      process.exit(1);
    }
    console.log(`[bridge-runtime] verified for ${triple}`);
  } else if (!present(dir)) {
    console.log("[bridge-runtime] not bundled — this build carries no bridge (`--build` assembles one)");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[bridge-runtime] ${err.message}`);
    process.exit(1);
  });
}
