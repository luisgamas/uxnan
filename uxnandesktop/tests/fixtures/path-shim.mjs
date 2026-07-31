/**
 * A PATH that cannot reach a real CLI.
 *
 * This is the piece that makes the fixtures safe rather than merely available.
 * Putting a fake `gh` *somewhere* is easy; guaranteeing that a test which forgets
 * to use it fails instead of quietly talking to the real GitHub is the part that
 * matters — and it is a stated stop condition for this harness that a fixture
 * must never be able to resolve `gh`, `codex`, `claude` or any other real CLI
 * from the machine's PATH.
 *
 * So `shimmedPath()` builds a directory containing *only* the fakes and returns a
 * PATH consisting of that directory and the interpreter needed to run them —
 * nothing else. A command the test didn't stub is then "not found", which is a
 * loud, obvious failure, instead of a real binary answering.
 *
 * `assertNoRealCli()` is the belt to that braces: it resolves each guarded name
 * against the shimmed PATH and fails if what comes back is not our shim.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** CLIs the app shells out to. A test must never reach the real one. */
export const GUARDED_CLIS = ["gh", "git", "claude", "codex", "opencode", "grok", "agy", "pi", "zero"];

/** Fixtures that stand in for a real CLI: name on PATH → script that answers. */
const FAKES = {
  gh: path.join(HERE, "fake-gh.mjs"),
};

/**
 * Create a directory of shims and return `{ dir, path, env }`.
 *
 * `env` is a complete environment for spawning a child: the shimmed `PATH`, the
 * latch each fake requires, and nothing inherited that could route around them.
 *
 * `allow` names guarded CLIs the test genuinely needs the real version of —
 * `git`, most of the time, since the repo fixtures are real repositories. Naming
 * it is the point: it is a decision in the test rather than an accident.
 */
export function shimmedPath(dir, { allow = [], env = {} } = {}) {
  fs.mkdirSync(dir, { recursive: true });

  for (const [name, script] of Object.entries(FAKES)) {
    if (allow.includes(name)) continue;
    writeShim(dir, name, script);
  }

  // Any guarded CLI with no fake becomes a shim that fails loudly, so "the test
  // forgot to stub this" reads as exactly that.
  for (const name of GUARDED_CLIS) {
    if (allow.includes(name) || name in FAKES) continue;
    writeRefusal(dir, name);
  }

  const parts = [dir];
  if (allow.length > 0) {
    // Re-admit only the directories that hold the allowed binaries, rather than
    // the whole inherited PATH.
    for (const name of allow) {
      const real = whichReal(name);
      if (real) parts.push(path.dirname(real));
    }
  }
  // The shims are Node scripts, so the interpreter has to stay reachable.
  parts.push(path.dirname(process.execPath));
  // …and so does the OS. A PATH of nothing but the shim directory cannot start a
  // child process at all on Windows — running a `.cmd` goes through `cmd.exe`,
  // which lives in System32 — so every spawn fails with ENOENT and the harness
  // looks like it is containing things when it is merely broken. These
  // directories hold no developer CLI, so admitting them costs no containment,
  // and `assertNoRealCli` re-checks that claim rather than assuming it.
  parts.push(...systemDirs());

  const shimmed = parts.join(path.delimiter);
  return {
    dir,
    path: shimmed,
    env: {
      ...env,
      PATH: shimmed,
      Path: shimmed, // Windows is case-insensitive but `spawn` is not
      UXNAN_FIXTURE_GH: "1",
    },
  };
}

/**
 * A directory holding **only** the fake `gh` shim, for prepending to an
 * otherwise-real PATH. The full `shimmedPath` replaces the world — right for
 * unit tests, wrong for the E2E app, which needs its real shell, git and
 * agents; the opt-in GitHub journey only needs `gh` re-routed. The caller
 * still owns the latch (`UXNAN_FIXTURE_GH=1`) and the canned responses.
 */
export function ghShimDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  writeShim(dir, "gh", FAKES.gh);
  return dir;
}

/** The OS's own directories: enough to start a process, and nothing more. */
function systemDirs() {
  if (process.platform === "win32") {
    const root = process.env.SystemRoot ?? "C:\\Windows";
    return [path.join(root, "System32"), root, path.join(root, "System32", "Wbem")];
  }
  return ["/usr/bin", "/bin"];
}

/** A shim that forwards to a fixture script. */
function writeShim(dir, name, script) {
  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(dir, `${name}.cmd`),
      `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`,
      "utf8",
    );
    return;
  }
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, "utf8");
  fs.chmodSync(file, 0o755);
}

/** A shim that exists only to fail with an explanation. */
function writeRefusal(dir, name) {
  const message = `${name}: blocked by the test harness. This test's PATH contains only fixtures; if it needs ${name}, stub it or pass it in \`allow\`.`;
  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(dir, `${name}.cmd`),
      `@echo off\r\necho ${message} 1>&2\r\nexit /b 127\r\n`,
      "utf8",
    );
    return;
  }
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\necho "${message}" >&2\nexit 127\n`, "utf8");
  fs.chmodSync(file, 0o755);
}

/** Where a name resolves on the *real* PATH, or `null`. */
function whichReal(name) {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const out = execFileSync(cmd, [name], { encoding: "utf8", windowsHide: true });
    return out.split(/\r?\n/).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

/**
 * Fail unless every guarded CLI resolves inside `dir` (or was explicitly
 * allowed). Call this once per suite that spawns processes: it is cheap, and it
 * is the difference between "the fixtures are configured" and "the fixtures are
 * configured *and* nothing can escape them".
 */
export function assertNoRealCli(shim, { allow = [] } = {}) {
  const escaped = [];
  for (const name of GUARDED_CLIS) {
    if (allow.includes(name)) continue;
    const resolved = resolveOn(shim.path, name);
    if (!resolved) {
      escaped.push(`${name}: did not resolve at all (the shim is missing)`);
      continue;
    }
    if (!resolved.toLowerCase().startsWith(shim.dir.toLowerCase())) {
      escaped.push(`${name}: resolved to ${resolved}, outside the shim directory`);
    }
  }
  if (escaped.length > 0) {
    throw new Error(`the test PATH can reach a real CLI:\n  ${escaped.join("\n  ")}`);
  }
}

/**
 * Resolve `name` against `searchPath` **without spawning anything**.
 *
 * The obvious implementation shells out to `where`/`which` with the shimmed
 * PATH — and cannot work: a PATH containing only the shim directory no longer
 * contains `System32`, so `where.exe` itself is not found and every lookup fails
 * identically, whether or not the shim is there. Doing the search in Node has no
 * such bootstrapping problem, and is faster besides.
 */
function resolveOn(searchPath, name) {
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  for (const entry of searchPath.split(path.delimiter).filter(Boolean)) {
    for (const ext of ["", ...exts]) {
      const candidate = path.join(entry, name + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return null;
}
