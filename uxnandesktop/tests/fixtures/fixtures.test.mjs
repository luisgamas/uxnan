/**
 * The fixtures test themselves.
 *
 * A fixture that is subtly wrong doesn't fail — it makes every test built on it
 * assert the wrong thing, confidently. The two properties that matter here are
 * *determinism* (the same setup produces the same world) and *containment* (a
 * test cannot reach the real machine), and neither is visible from the tests
 * that consume them. So they are checked directly.
 *
 * Containment is the one with teeth: reaching the real `gh` from a test would
 * mean network calls, rate limits and, for anything that writes, real changes to
 * somebody's repository.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertNoRealCli, GUARDED_CLIS, shimmedPath } from "./path-shim.mjs";
import { LEGACY_PROFILES, makeLegacyProfile, makeProfile, readProfile } from "./appdata.mjs";
import { FAKE_AGENT, FIXTURE_HTTP_SERVER } from "./shared.mjs";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "uxnan-fixtures-test-"));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

const FAKE_GH = path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), "fake-gh.mjs");

/** Run the fake gh directly, with the environment a test would give it. */
function gh(args, env = {}) {
  return spawnSync(process.execPath, [FAKE_GH, ...args], {
    encoding: "utf8",
    env: { ...process.env, UXNAN_FIXTURE_GH: "1", ...env },
    windowsHide: true,
  });
}

describe("the fake gh", () => {
  it("refuses to run without its latch", () => {
    const out = spawnSync(process.execPath, [FAKE_GH, "--version"], {
      encoding: "utf8",
      env: { ...process.env, UXNAN_FIXTURE_GH: "" },
      windowsHide: true,
    });
    expect(out.status).toBe(64);
    expect(out.stderr).toMatch(/refusing to run/);
  });

  it("answers the commands the app asks on startup", () => {
    expect(gh(["--version"]).stdout).toMatch(/fixture/);
    expect(gh(["auth", "status"]).stdout).toMatch(/Logged in/);
    expect(JSON.parse(gh(["api", "rate_limit"]).stdout).resources.core.limit).toBe(5000);
  });

  it("is deterministic — the same call twice gives the same bytes", () => {
    expect(gh(["pr", "list"]).stdout).toBe(gh(["pr", "list"]).stdout);
  });

  it("fails on demand, the way the real one fails", () => {
    const out = gh(["pr", "list"], { UXNAN_FIXTURE_GH_FAIL: "1" });
    expect(out.status).toBe(1);
    expect(out.stderr).toMatch(/could not complete/);
  });

  it("says so loudly when a test forgot to stub a command", () => {
    // Silence here would mean the caller parses an empty string and asserts
    // something meaningless.
    const out = gh(["pr", "merge", "42"]);
    expect(out.status).toBe(65);
    expect(out.stderr).toMatch(/no canned response/);
  });

  it("serves per-test canned responses, longest match first", () => {
    const file = path.join(TMP, "responses.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ pr: [{ number: 1 }], "pr list": [{ number: 7, title: "Specific" }] }),
    );
    const out = JSON.parse(gh(["pr", "list"], { UXNAN_FIXTURE_GH_RESPONSES: file }).stdout);
    expect(out[0].title).toBe("Specific");
  });

  it("logs the arguments it was given", () => {
    const log = path.join(TMP, "calls.log");
    gh(["pr", "list", "--limit", "5"], { UXNAN_FIXTURE_GH_LOG: log });
    const entries = fs
      .readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(entries.at(-1).argv).toEqual(["pr", "list", "--limit", "5"]);
  });

  it("never writes a credential to that log", () => {
    // A fixture that records secrets is a fixture that eventually commits one.
    const log = path.join(TMP, "scrubbed.log");
    gh(["api", "-H", "Authorization: Bearer ghp_0123456789abcdefghij", "user"], {
      UXNAN_FIXTURE_GH_LOG: log,
    });
    const text = fs.readFileSync(log, "utf8");
    expect(text).not.toContain("ghp_0123456789abcdefghij");
    expect(text).toMatch(/<redacted>|<token>/);
  });
});

/**
 * Run a shim the way a shell would.
 *
 * `shell: true` is required rather than stylistic: since the BatBadBut hardening
 * (CVE-2024-27980) Node refuses to spawn a `.cmd`/`.bat` directly and fails with
 * `EINVAL`. The shims are `.cmd` files because the *app* resolves them from Rust,
 * which has no such restriction — so it is these tests, not the shim, that have
 * to go through a shell.
 */
function runShim(name, args, shim) {
  // One command string rather than an args array: with `shell: true` Node
  // concatenates without escaping and warns about it (DEP0190). The arguments
  // here are literals written in this file, so there is nothing to escape — but
  // the warning is right in general, and the string form says so explicitly.
  return spawnSync([name, ...args].join(" "), {
    encoding: "utf8",
    env: { ...process.env, ...shim.env },
    windowsHide: true,
    shell: true,
  });
}

describe("the shimmed PATH", () => {
  let shim;

  beforeAll(() => {
    shim = shimmedPath(path.join(TMP, "bin"));
  });

  it("resolves every guarded CLI inside the shim directory", () => {
    // The assertion that keeps a test from ever reaching the real GitHub.
    expect(() => assertNoRealCli(shim)).not.toThrow();
  });

  it("routes gh to the fixture, not to whatever is installed", () => {
    const out = runShim("gh", ["--version"], shim);
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/fixture/);
  });

  it("turns an unstubbed CLI into a loud failure rather than a real invocation", () => {
    const out = runShim("claude", ["-p", "hi"], shim);
    expect(out.status).toBe(127);
    expect(out.stderr).toMatch(/blocked by the test harness/);
  });

  it("re-admits a real CLI only when the test names it", () => {
    // The repo fixtures are real git repositories, so `git` is the usual — and
    // deliberate — exception.
    const allowing = shimmedPath(path.join(TMP, "bin-git"), { allow: ["git"] });
    expect(() => assertNoRealCli(allowing, { allow: ["git"] })).not.toThrow();
    const out = execFileSync("git", ["--version"], {
      encoding: "utf8",
      env: { ...process.env, ...allowing.env },
      windowsHide: true,
    });
    expect(out).toMatch(/git version/);
  });

  it("guards every CLI the app is known to shell out to", () => {
    // A new agent added to the app without being added here would be reachable
    // from a test; keep the list honest.
    expect(GUARDED_CLIS).toEqual(
      expect.arrayContaining(["gh", "git", "claude", "codex", "opencode", "grok", "agy", "pi", "zero"]),
    );
  });
});

describe("disposable app profiles", () => {
  it("writes a usable profile and points UXNAN_DATA_DIR at it", () => {
    const { dir, env } = makeProfile(path.join(TMP, "profile"));
    expect(env.UXNAN_DATA_DIR).toBe(dir);
    expect(readProfile(dir)?.version).toBe(1);
  });

  it("offers a legacy profile for every shape the migration has to survive", () => {
    for (const name of Object.keys(LEGACY_PROFILES)) {
      const { dir } = makeLegacyProfile(path.join(TMP, `legacy-${name}`), name);
      expect(fs.existsSync(path.join(dir, "state.json"))).toBe(true);
    }
  });

  it("includes a profile that is not valid JSON at all", () => {
    // The interrupted-write case: the app must still start.
    const { dir } = makeLegacyProfile(path.join(TMP, "legacy-truncated"), "truncated");
    expect(readProfile(dir)).toBeNull();
  });

  it("rejects an unknown legacy name instead of writing an empty profile", () => {
    expect(() => makeLegacyProfile(TMP, "does-not-exist")).toThrow(/unknown legacy profile/);
  });
});

describe("fixtures shared with the resource benchmarks", () => {
  it("points at the one implementation of each, not a copy", () => {
    // A second generator would drift; the benchmark's repo fixture is only
    // useful because its commit hash is pinned.
    expect(fs.existsSync(FAKE_AGENT)).toBe(true);
    expect(fs.existsSync(FIXTURE_HTTP_SERVER)).toBe(true);
    expect(FAKE_AGENT).toMatch(/scripts[\\/]resources[\\/]fixtures/);
  });
});
