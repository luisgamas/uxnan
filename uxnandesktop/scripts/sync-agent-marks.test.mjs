import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAppMark, syncAgentMarks } from "./sync-agent-marks.mjs";

describe("sync-agent-marks", () => {
  it("copies the drawn and vendored marks, not the README-only dark variants", () => {
    expect(isAppMark("codex.svg")).toBe(true);
    expect(isAppMark("opencode.png")).toBe(true);
    expect(isAppMark("codex-on-dark.svg")).toBe(false);
    expect(isAppMark("README.md")).toBe(false);
    const source = mkdtempSync(join(tmpdir(), "marks-src-"));
    const target = join(mkdtempSync(join(tmpdir(), "marks-dst-")), "agents");
    for (const f of ["codex.svg", "codex-on-dark.svg", "pi.png"]) writeFileSync(join(source, f), f);
    expect(syncAgentMarks(source, target).sort()).toEqual(["codex.svg", "pi.png"]);
    expect(readdirSync(target).sort()).toEqual(["codex.svg", "pi.png"]);
  });

  it("refuses to run without the repository's set", () => {
    const empty = join(mkdtempSync(join(tmpdir(), "marks-none-")), "missing");
    expect(() => syncAgentMarks(empty, join(tmpdir(), "x"))).toThrow(/assets\/agents/);
    mkdirSync(empty);
  });
});
