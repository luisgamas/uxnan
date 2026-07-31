/**
 * The GitHub validation tooling's own tests — pure logic plus the sandbox
 * harness's refusals, exercised as real child processes against a PATH that
 * cannot reach a real `gh`.
 *
 * These run in the required suite, so nothing here touches the network: the
 * only harness paths spawned are the ones that must refuse or print a plan
 * *before* any `gh` invocation would happen. That refusal behavior is exactly
 * what makes the mutating half safe to even have in the repository.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import {
  FORBIDDEN_REPOS,
  SANDBOX_REPO,
  isReadInvocation,
  redactArgvForLog,
  requireSandbox,
  sanitizeCapture,
  scrubSecrets,
} from "./lib.mjs";
import { shimmedPath } from "../../tests/fixtures/path-shim.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX_SCRIPT = path.join(HERE, "sandbox.mjs");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "uxnan-gh-harness-test-"));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe("the sandbox allowlist", () => {
  it("refuses when UXNAN_GH_SANDBOX is not set, and names the fix", () => {
    expect(() => requireSandbox({})).toThrow(/UXNAN_GH_SANDBOX is not set/);
    expect(() => requireSandbox({})).toThrow(new RegExp(SANDBOX_REPO));
  });

  it("refuses the production repository by name", () => {
    for (const repo of FORBIDDEN_REPOS) {
      expect(() => requireSandbox({ UXNAN_GH_SANDBOX: repo })).toThrow(/production repository/);
    }
  });

  it("refuses every value that is not exactly the allowlisted sandbox", () => {
    for (const wrong of [
      "luisgamas/uxnan-gh-sandbox-2",
      "someone-else/uxnan-gh-sandbox",
      "LUISGAMAS/UXNAN-GH-SANDBOX",
      "https://github.com/luisgamas/uxnan-gh-sandbox",
      "",
      "   ",
    ]) {
      expect(() => requireSandbox({ UXNAN_GH_SANDBOX: wrong }), wrong).toThrow();
    }
  });

  it("accepts exactly the allowlisted sandbox (whitespace-trimmed)", () => {
    expect(requireSandbox({ UXNAN_GH_SANDBOX: SANDBOX_REPO })).toEqual({
      owner: "luisgamas",
      repo: "uxnan-gh-sandbox",
      nameWithOwner: SANDBOX_REPO,
    });
    expect(requireSandbox({ UXNAN_GH_SANDBOX: ` ${SANDBOX_REPO} ` }).nameWithOwner).toBe(
      SANDBOX_REPO,
    );
  });
});

describe("scrubbing and redaction", () => {
  it("replaces token-shaped strings everywhere", () => {
    expect(scrubSecrets("Bearer ghp_0123456789abcdefghij")).toBe("Bearer <redacted>");
    expect(scrubSecrets("x gho_0123456789abcdefghij y")).toBe("x <token> y");
    expect(scrubSecrets("github_pat_11ABCD0123456789abcdefgh")).toBe("<token>");
    expect(scrubSecrets("https://user:pass@github.com/x")).toBe("https://<credentials>@github.com/x");
    expect(scrubSecrets("--token abc")).toBe("--token <redacted>");
  });

  it("redacts user-authored argv values but keeps the command readable", () => {
    expect(redactArgvForLog(["pr", "comment", "7", "--body", "private text"])).toEqual([
      "pr",
      "comment",
      "7",
      "--body",
      "<redacted>",
    ]);
    expect(redactArgvForLog(["api", "x", "-f", "k=v", "--field=a b"])).toEqual([
      "api",
      "x",
      "-f",
      "<redacted>",
      "--field=<redacted>",
    ]);
  });
});

describe("capture sanitization", () => {
  it("strips node ids and redacts emails while preserving shape", () => {
    const raw = {
      node_id: "MDQ6VXNlcjc3OTU2NDI4",
      id: "IC_kwDOSyL5bc8AAAABMlrjTQ",
      databaseId: 12345,
      author: { name: "Dev", email: "dev@real-domain.com" },
      body: "ping dev@real-domain.com about gho_0123456789abcdefghij",
      nested: [{ gravatar_id: "", login: "luisgamas" }],
    };
    const clean = sanitizeCapture(raw);
    expect(clean).toEqual({
      databaseId: 12345,
      author: { name: "Dev", email: "redacted@example.invalid" },
      body: "ping redacted@example.invalid about <token>",
      nested: [{ login: "luisgamas" }],
    });
  });
});

describe("the read/mutation classifier", () => {
  it("recognizes the read surface production uses", () => {
    expect(isReadInvocation(["pr", "list", "--json", "number"])).toBe(true);
    expect(isReadInvocation(["pr", "view", "7", "--json", "title"])).toBe(true);
    expect(isReadInvocation(["auth", "status", "--json", "hosts"])).toBe(true);
    expect(isReadInvocation(["api", "rate_limit"])).toBe(true);
    expect(isReadInvocation(["api", "repos/o/r/rules/branches/main"])).toBe(true);
    expect(isReadInvocation(["--version"])).toBe(true);
  });

  it("classifies anything that could write as a mutation", () => {
    expect(isReadInvocation(["pr", "merge", "7", "--squash"])).toBe(false);
    expect(isReadInvocation(["pr", "create", "--title", "t"])).toBe(false);
    expect(isReadInvocation(["issue", "close", "1"])).toBe(false);
    expect(isReadInvocation(["repo", "create", "x"])).toBe(false);
    expect(isReadInvocation(["api", "repos/o/r/topics", "-X", "PUT"])).toBe(false);
    expect(isReadInvocation(["api", "repos/o/r", "-X", "PATCH"])).toBe(false);
    // gh defaults `api` to POST when fields are present — fields make it a write.
    expect(isReadInvocation(["api", "repos/o/r/issues", "-f", "title=x"])).toBe(false);
    // …but an explicit GET stays a read.
    expect(isReadInvocation(["api", "search/issues", "-X", "GET", "-f", "q=x"])).toBe(true);
  });
});

/**
 * Spawn the sandbox harness the way an operator would, but with a PATH that
 * cannot reach a real `gh` — so even a bug in these refusal paths could not
 * mutate anything from inside the test suite.
 */
function runSandbox(args, env = {}) {
  const shim = shimmedPath(path.join(TMP, `bin-${Math.random().toString(36).slice(2)}`));
  return spawnSync(process.execPath, [SANDBOX_SCRIPT, ...args], {
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      ...shim.env,
      UXNAN_FIXTURE_GH: "", // even the fake gh refuses: these paths must not need one
      UXNAN_GH_SANDBOX: "",
      ...env,
    },
  });
}

describe("the sandbox harness (as a child process, no gh reachable)", () => {
  it("refuses to do anything without UXNAN_GH_SANDBOX", () => {
    const out = runSandbox(["setup"]);
    expect(out.status).toBe(1);
    expect(out.stderr).toMatch(/UXNAN_GH_SANDBOX is not set/);
  });

  it("refuses the production repository loudly", () => {
    const out = runSandbox(["cleanup", "--execute"], { UXNAN_GH_SANDBOX: "luisgamas/uxnan" });
    expect(out.status).toBe(1);
    expect(out.stderr).toMatch(/production repository/);
    expect(out.stderr).toMatch(/will never mutate it/);
  });

  it("prints a dry-run plan by default and touches nothing", () => {
    const out = runSandbox(["setup"], { UXNAN_GH_SANDBOX: SANDBOX_REPO });
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/DRY-RUN \(nothing will be touched/);
    expect(out.stdout).toMatch(/gh repo create luisgamas\/uxnan-gh-sandbox --public/);
    expect(out.stdout).toMatch(/verify:/);
    // The dry-run of a mutating command never invokes gh at all — with no
    // reachable gh, reaching the plan proves it.
  });

  it("blocks --execute while a failure artifact from a previous run exists", () => {
    const artifact = path.join(TMP, "failure.json");
    fs.writeFileSync(artifact, JSON.stringify({ failedStep: "x" }), "utf8");
    const out = runSandbox(["cleanup", "--execute"], {
      UXNAN_GH_SANDBOX: SANDBOX_REPO,
      UXNAN_GH_SANDBOX_STATE: artifact,
    });
    expect(out.status).toBe(1);
    expect(out.stderr).toMatch(/previous --execute run failed/);
  });
});
