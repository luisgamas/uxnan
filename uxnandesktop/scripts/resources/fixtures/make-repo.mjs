#!/usr/bin/env node
/**
 * Deterministic git fixtures.
 *
 * The Git scenarios need a repository whose size and shape are the same on every
 * machine and every run — otherwise "status took 180 ms" says as much about the
 * checkout as about the app. Generating it beats committing it: 10 000 files
 * would be a miserable thing to carry in the repo, and generation is verifiable
 * (the commit hash is fixed, so a drifted generator is caught immediately).
 *
 * Determinism comes from pinning everything git would otherwise take from the
 * environment: author, committer, both timestamps, and the file content (derived
 * from a seeded PRNG, never `Math.random`). The same arguments therefore always
 * produce the same commit hash, which `--print-hash` prints so a test can assert
 * it.
 *
 * Usage:
 *   node make-repo.mjs --dir <path> [--files 200] [--dirs 20] [--dirty 0]
 *   node make-repo.mjs --dir <path> --print-hash
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Deterministic 32-bit PRNG (mulberry32) — same seed, same repository. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
  "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "pi",
];

function fileBody(rand, lines) {
  const out = [];
  for (let i = 0; i < lines; i += 1) {
    const a = WORDS[Math.floor(rand() * WORDS.length)];
    const b = WORDS[Math.floor(rand() * WORDS.length)];
    out.push(`export const ${a}_${i} = "${b}-${Math.floor(rand() * 1000)}";`);
  }
  return `${out.join("\n")}\n`;
}

/** Fixed identity + timestamps, so the commit hash is a function of the tree. */
const GIT_ENV = {
  GIT_AUTHOR_NAME: "Uxnan Benchmark",
  GIT_AUTHOR_EMAIL: "benchmark@uxnan.invalid",
  GIT_COMMITTER_NAME: "Uxnan Benchmark",
  GIT_COMMITTER_EMAIL: "benchmark@uxnan.invalid",
  GIT_AUTHOR_DATE: "2020-01-01T00:00:00+0000",
  GIT_COMMITTER_DATE: "2020-01-01T00:00:00+0000",
  // Ignore the operator's own git config: an `init.defaultBranch`, a
  // `commit.gpgsign` or a template dir would change the result.
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(dir, args) {
  return execFileSync("git", args, {
    cwd: dir,
    env: { ...process.env, ...GIT_ENV },
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

/**
 * Create (or reuse) the fixture repository at `dir` and return
 * `{ dir, head, files, reused }`.
 *
 * An existing directory with the expected commit is reused as-is — generating
 * 10 000 files takes seconds and every repetition of a scenario would otherwise
 * pay for it again.
 */
export function makeRepo({ dir, files = 200, dirs = 20, dirty = 0, lines = 40, seed = 42 }) {
  const marker = path.join(dir, ".uxnan-fixture.json");
  const want = { files, dirs, lines, seed, version: 1 };
  if (fs.existsSync(marker)) {
    try {
      const have = JSON.parse(fs.readFileSync(marker, "utf8"));
      if (JSON.stringify(have.spec) === JSON.stringify(want)) {
        applyDirty(dir, dirty, seed);
        return { dir, head: have.head, files, reused: true };
      }
    } catch {
      /* regenerate below */
    }
  }

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ["init", "--quiet", "--initial-branch=main"]);
  git(dir, ["config", "user.name", GIT_ENV.GIT_AUTHOR_NAME]);
  git(dir, ["config", "user.email", GIT_ENV.GIT_AUTHOR_EMAIL]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  git(dir, ["config", "core.autocrlf", "false"]);

  const rand = rng(seed);
  for (let i = 0; i < files; i += 1) {
    const bucket = dirs > 0 ? `src/mod${String(i % dirs).padStart(3, "0")}` : "src";
    const full = path.join(dir, bucket);
    fs.mkdirSync(full, { recursive: true });
    fs.writeFileSync(path.join(full, `file${String(i).padStart(5, "0")}.ts`), fileBody(rand, lines));
  }
  fs.writeFileSync(
    path.join(dir, "README.md"),
    `# uxnan resource fixture\n\nGenerated repository: ${files} files in ${dirs} directories.\n`,
  );
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "--quiet", "-m", "chore: generated resource fixture"]);
  const head = git(dir, ["rev-parse", "HEAD"]);
  fs.writeFileSync(marker, JSON.stringify({ spec: want, head }, null, 2));
  applyDirty(dir, dirty, seed);
  return { dir, head, files, reused: false };
}

/** Leave `count` files modified, so a status scan has real work to do. */
function applyDirty(dir, count, seed) {
  if (!count) return;
  const rand = rng(seed + 7);
  const all = listTracked(dir);
  for (let i = 0; i < Math.min(count, all.length); i += 1) {
    const target = path.join(dir, all[Math.floor(rand() * all.length)]);
    try {
      fs.appendFileSync(target, `// touched ${i}\n`);
    } catch {
      /* skip */
    }
  }
}

function listTracked(dir) {
  return git(dir, ["ls-files"])
    .split(/\r?\n/)
    .filter((l) => l.endsWith(".ts"));
}

// --- CLI -------------------------------------------------------------------

function isMain() {
  return process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
}

if (isMain()) {
  const argv = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? fallback : argv[i + 1];
  };
  const dir = arg("dir");
  if (!dir) {
    console.error("make-repo.mjs: --dir <path> is required");
    process.exit(2);
  }
  const result = makeRepo({
    dir: path.resolve(dir),
    files: Number(arg("files", 200)),
    dirs: Number(arg("dirs", 20)),
    dirty: Number(arg("dirty", 0)),
    lines: Number(arg("lines", 40)),
    seed: Number(arg("seed", 42)),
  });
  if (argv.includes("--print-hash")) console.log(result.head);
  else console.log(JSON.stringify(result));
}
