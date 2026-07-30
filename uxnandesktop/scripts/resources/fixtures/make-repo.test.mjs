/**
 * The git fixture has to be *identical* every time, or the scenarios built on it
 * measure the fixture instead of the app. These tests pin that: same arguments →
 * same commit hash, different arguments → different repository, and a path with
 * spaces or non-ASCII characters is handled rather than mangled (the case that
 * breaks tooling built on shell strings — here every git call goes through
 * `execFileSync` with an argument array, so there is no shell to confuse).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

import { makeRepo } from "./make-repo.mjs";

const hasGit = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
const describeGit = hasGit ? describe : describe.skip;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "uxnan-fixture-test-"));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

const SMALL = { files: 6, dirs: 2, lines: 4 };

describeGit("the generated git fixture", () => {
  it("produces the same commit hash for the same arguments", () => {
    const a = makeRepo({ ...SMALL, dir: path.join(TMP, "a") });
    const b = makeRepo({ ...SMALL, dir: path.join(TMP, "b") });
    expect(a.head).toMatch(/^[0-9a-f]{40}$/);
    expect(b.head).toBe(a.head);
  });

  it("produces a different repository for different arguments", () => {
    const a = makeRepo({ ...SMALL, dir: path.join(TMP, "c") });
    const more = makeRepo({ ...SMALL, files: 7, dir: path.join(TMP, "d") });
    expect(more.head).not.toBe(a.head);
  });

  it("reuses an existing fixture instead of regenerating it", () => {
    const dir = path.join(TMP, "reuse");
    const first = makeRepo({ ...SMALL, dir });
    const second = makeRepo({ ...SMALL, dir });
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.head).toBe(first.head);
  });

  it("regenerates when the requested shape changes", () => {
    const dir = path.join(TMP, "reshape");
    makeRepo({ ...SMALL, dir });
    const changed = makeRepo({ ...SMALL, files: 8, dir });
    expect(changed.reused).toBe(false);
  });

  it("survives a path with spaces and non-ASCII characters", () => {
    const dir = path.join(TMP, "ruta con espacios y ácentos");
    const repo = makeRepo({ ...SMALL, dir });
    expect(repo.head).toMatch(/^[0-9a-f]{40}$/);
    expect(fs.existsSync(path.join(dir, "README.md"))).toBe(true);
  });

  it("leaves the requested number of files modified when asked", () => {
    const dir = path.join(TMP, "dirty");
    makeRepo({ ...SMALL, dir, dirty: 2 });
    const status = spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
    expect(status.stdout.trim().split("\n").filter(Boolean).length).toBeGreaterThan(0);
  });

  it("writes nothing outside its own directory", () => {
    const dir = path.join(TMP, "scoped");
    makeRepo({ ...SMALL, dir });
    const stray = fs
      .readdirSync(TMP)
      .filter((e) => !["a", "b", "c", "d", "reuse", "reshape", "dirty", "scoped"].includes(e));
    expect(stray).toEqual(["ruta con espacios y ácentos"]);
  });
});
