/**
 * Coverage for the Unix collector's parser.
 *
 * `unix.sh` has never been run on real macOS or Linux hardware, so its awk
 * program — the part that turns `ps` output into schema rows — is the piece most
 * likely to be quietly wrong when someone finally does. It is pure text
 * transformation, so it can be exercised anywhere `awk` exists: the test lifts
 * the program out of the script (rather than duplicating it, which would test a
 * copy) and feeds it a synthetic snapshot.
 *
 * Skipped where `awk` is unavailable — Windows runners, mainly. Linux and macOS
 * CI legs run it, which is precisely where the script is destined to live.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "unix.sh");

const hasAwk = spawnSync("awk", ["--version"], { encoding: "utf8" }).error === undefined;
const describeAwk = hasAwk ? describe : describe.skip;

/** Lift the awk program out of `emit_rows`, so the test runs the real thing. */
function awkProgram() {
  const src = fs.readFileSync(SCRIPT, "utf8");
  const start = src.indexOf("awk -v filter=");
  const open = src.indexOf("'", start);
  const close = src.indexOf("\n  '", open);
  if (start === -1 || open === -1 || close === -1) {
    throw new Error("could not find the awk program in unix.sh — did emit_rows change shape?");
  }
  return src.slice(open + 1, close);
}

/**
 * A tree matching what `ps -e -o pid=,ppid=,rss=,etime=,time=,comm=` prints:
 *
 *   100 uxnan-desktop        the app we launched
 *   ├─ 101 WebKitWebProcess  its webview helper
 *   ├─ 103 bash              a shell it spawned
 *   │   └─ 104 node          the agent the user ran
 *   900 uxnan-desktop        an unrelated instance — must never be counted
 */
const PS = [
  "100 1 27000 05:00 00:01:30 uxnan-desktop",
  "101 100 90000 05:00 00:00:45.50 WebKitWebProcess",
  "103 100 4000 04:59 00:00:01 bash",
  "104 103 120000 04:58 00:02:00 node",
  "900 1 999000 06:00 01:10:00 uxnan-desktop",
].join("\n");

// The program goes to a file rather than an argument: it is dense with quotes
// and backslashes, and Windows argument escaping would corrupt it on the way in.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "uxnan-awk-test-"));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

function run({ filter = "", root = 0, name = "" }) {
  const file = path.join(TMP, "rows.awk");
  fs.writeFileSync(file, awkProgram(), "utf8");
  const out = execFileSync(
    "awk",
    ["-v", `filter=${filter}`, "-v", `root=${root}`, "-v", `namefilter=${name}`, "-f", file],
    { input: PS, encoding: "utf8" },
  );
  return JSON.parse(`[${out.trim()}]`);
}

describeAwk("the unix collector's row parser", () => {
  it("walks the subtree of the root and nothing else", () => {
    const rows = run({ root: 100 });
    expect(rows.map((r) => r.pid)).toEqual([100, 101, 103, 104]);
    // The same-named process 900 is not a descendant, so it is invisible —
    // the whole point of structural attribution.
    expect(rows.some((r) => r.pid === 900)).toBe(false);
  });

  it("parses cumulative CPU time into milliseconds", () => {
    const rows = run({ root: 100 });
    const cpu = Object.fromEntries(rows.map((r) => [r.pid, r.cpuMs]));
    expect(cpu[100]).toBe(90_000); // 00:01:30
    expect(cpu[101]).toBe(45_500); // 00:00:45.50 — hundredths kept
    expect(cpu[104]).toBe(120_000); // 00:02:00
  });

  it("handles an hours component", () => {
    const [row] = run({ filter: "900" });
    expect(row.cpuMs).toBe(4_200_000); // 01:10:00
  });

  it("reports the metrics Unix cannot cheaply provide as null, not zero", () => {
    const [row] = run({ filter: "100" });
    expect(row.privateKb).toBeNull();
    expect(row.threads).toBeNull();
    expect(row.handles).toBeNull();
    expect(row.rssKb).toBe(27_000);
  });

  it("selects an explicit pid list, ignoring the tree", () => {
    expect(run({ filter: "103,104" }).map((r) => r.pid)).toEqual([103, 104]);
  });

  it("selects by executable name for the pre-flight guard only", () => {
    // This is the one place a name is matched — "is another instance running?".
    expect(run({ name: "uxnan-desktop" }).map((r) => r.pid)).toEqual([100, 900]);
  });

  it("emits nothing when the root is not in the snapshot", () => {
    expect(run({ root: 555 })).toEqual([]);
  });
});
