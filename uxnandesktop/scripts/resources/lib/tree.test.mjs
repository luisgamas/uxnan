import { describe, expect, it } from "vitest";

import {
  aggregate,
  childClass,
  classifyTree,
  EXTERNAL,
  findOrphans,
  isShell,
  MANAGED,
  normalizeName,
  OWN,
} from "./tree.mjs";

/** Build a row with sane defaults so a test only states what it cares about. */
function row(pid, ppid, name, extra = {}) {
  return { pid, ppid, name, rssKb: 1024, cpuMs: 0, threads: 1, handles: 10, ...extra };
}

/**
 * The tree a real Windows run produces:
 *
 *   100 uxnan-desktop.exe            own
 *   ├─ 101 msedgewebview2.exe        own (runtime helper)
 *   ├─ 102 conhost.exe               managed (ConPTY plumbing)
 *   ├─ 103 cmd.exe                   managed (a shell uxnan spawned)
 *   │   └─ 104 node.exe (agent)      external (what the user ran)
 *   │       └─ 105 rg.exe            external
 *   └─ 106 git.exe                   managed (uxnan's own sidecar)
 *       └─ 107 git-remote-https.exe  managed
 */
const TREE = [
  row(100, 1, "uxnan-desktop.exe", { rssKb: 200 * 1024 }),
  row(101, 100, "msedgewebview2.exe", { rssKb: 80 * 1024 }),
  row(102, 100, "conhost.exe", { rssKb: 6 * 1024 }),
  row(103, 100, "cmd.exe", { rssKb: 4 * 1024 }),
  row(104, 103, "node.exe", { rssKb: 120 * 1024 }),
  row(105, 104, "rg.exe", { rssKb: 30 * 1024 }),
  row(106, 100, "git.exe", { rssKb: 12 * 1024 }),
  row(107, 106, "git-remote-https.exe", { rssKb: 8 * 1024 }),
];

describe("normalizeName", () => {
  it("strips the path and a known executable extension", () => {
    expect(normalizeName("C:\\Windows\\System32\\cmd.exe")).toBe("cmd");
    expect(normalizeName("/bin/bash")).toBe("bash");
    expect(normalizeName("Node.EXE")).toBe("node");
  });

  it("leaves an unknown extension alone", () => {
    expect(normalizeName("uxnan-desktop")).toBe("uxnan-desktop");
    expect(normalizeName("weird.thing")).toBe("weird.thing");
  });

  it("recognises the shells the agent detector descends through", () => {
    for (const s of ["cmd.exe", "powershell.exe", "pwsh", "bash", "zsh", "fish", "nu"]) {
      expect(isShell(s)).toBe(true);
    }
    expect(isShell("node.exe")).toBe(false);
  });
});

describe("classifyTree", () => {
  it("labels every node of a realistic tree", () => {
    const classes = classifyTree(TREE, 100);
    expect(classes.get(100)).toBe(OWN);
    expect(classes.get(101)).toBe(OWN); // webview helper
    expect(classes.get(102)).toBe(MANAGED); // conhost
    expect(classes.get(103)).toBe(MANAGED); // shell
    expect(classes.get(104)).toBe(EXTERNAL); // the agent the user launched
    expect(classes.get(105)).toBe(EXTERNAL); // and its own child
    expect(classes.get(106)).toBe(MANAGED); // uxnan's git call
    expect(classes.get(107)).toBe(MANAGED); // git's own helper
  });

  it("sees through a shell shim to the real program", () => {
    // cmd → powershell → node: the shim stays managed, the program is external.
    const rows = [
      row(1, 0, "uxnan-desktop.exe"),
      row(2, 1, "cmd.exe"),
      row(3, 2, "powershell.exe"),
      row(4, 3, "node.exe"),
    ];
    const classes = classifyTree(rows, 1);
    expect(classes.get(3)).toBe(MANAGED);
    expect(classes.get(4)).toBe(EXTERNAL);
  });

  it("ignores a same-named process that is not a descendant", () => {
    // A `uxnan-desktop.exe` the operator already had open must not be counted.
    const rows = [...TREE, row(900, 1, "uxnan-desktop.exe", { rssKb: 999 * 1024 })];
    const classes = classifyTree(rows, 100);
    expect(classes.has(900)).toBe(false);
  });

  it("returns nothing when the root is absent (the app already exited)", () => {
    expect(classifyTree(TREE, 555).size).toBe(0);
  });

  it("survives a cycle a recycled parent PID could forge", () => {
    const rows = [row(1, 0, "uxnan-desktop.exe"), row(2, 1, "cmd.exe"), row(1, 2, "ghost.exe")];
    const classes = classifyTree(rows, 1);
    expect(classes.get(1)).toBe(OWN);
    expect(classes.size).toBeLessThanOrEqual(2);
  });

  it("skips rows with no usable pid", () => {
    const rows = [row(1, 0, "uxnan-desktop.exe"), { pid: null, ppid: 1, name: "junk" }];
    expect(classifyTree(rows, 1).size).toBe(1);
  });
});

describe("childClass rules", () => {
  it("keeps everything under an external process external", () => {
    expect(childClass(EXTERNAL, "node.exe", "cmd.exe")).toBe(EXTERNAL);
  });

  it("treats a non-shell sidecar's children as still managed", () => {
    expect(childClass(MANAGED, "git.exe", "git-remote-https.exe")).toBe(MANAGED);
  });
});

describe("aggregate", () => {
  it("never folds external cost into own or managed", () => {
    const folded = aggregate(TREE, 100);
    expect(folded.own.rssMb).toBeCloseTo(280, 5); // app + webview
    expect(folded.managed.rssMb).toBeCloseTo(310, 5); // + conhost, cmd, git, git helper
    expect(folded.external.rssMb).toBeCloseTo(150, 5); // agent + ripgrep
    expect(folded.own.procs).toBe(2);
    expect(folded.managed.procs).toBe(6);
    expect(folded.external.procs).toBe(2);
  });

  it("reports CPU as null on the first sample instead of inventing a zero", () => {
    const folded = aggregate(TREE, 100);
    expect(folded.own.cpuPct).toBeNull();
  });

  it("derives a rate once there is a previous reading", () => {
    const first = aggregate(TREE, 100, { prevCpuMs: null, elapsedMs: null });
    const later = TREE.map((r) => (r.pid === 100 ? { ...r, cpuMs: 500 } : r));
    const second = aggregate(later, 100, { prevCpuMs: first.cpuMsByPid, elapsedMs: 1000 });
    expect(second.own.cpuPct).toBeCloseTo(50, 5);
  });

  it("does not charge a newly-appeared process its whole lifetime CPU", () => {
    const first = aggregate([row(1, 0, "uxnan-desktop.exe", { cpuMs: 0 })], 1);
    const withChild = [
      row(1, 0, "uxnan-desktop.exe", { cpuMs: 0 }),
      row(2, 1, "cmd.exe", { cpuMs: 9_000 }),
    ];
    const second = aggregate(withChild, 1, { prevCpuMs: first.cpuMsByPid, elapsedMs: 1000 });
    expect(second.managed.cpuPct).toBe(0);
  });

  it("marks unavailable per-process metrics as null, not zero", () => {
    const rows = [row(1, 0, "uxnan-desktop", { threads: null, handles: null, privateKb: null })];
    const folded = aggregate(rows, 1);
    expect(folded.own.threads).toBeNull();
    expect(folded.own.handles).toBeNull();
    expect(folded.own.privateMb).toBeNull();
  });
});

describe("findOrphans", () => {
  it("reports managed processes still alive after teardown", () => {
    const after = [row(103, 1, "cmd.exe"), row(104, 103, "node.exe")];
    const orphans = findOrphans(TREE, 100, after);
    expect(orphans).toEqual([
      { bucket: MANAGED, name: "cmd" },
      { bucket: EXTERNAL, name: "node" },
    ]);
  });

  it("is empty when the tree is gone", () => {
    expect(findOrphans(TREE, 100, [])).toEqual([]);
  });

  it("does not blame a recycled PID now owned by something else", () => {
    const before = [row(1, 0, "uxnan-desktop.exe"), row(2, 1, "cmd.exe", { startedAt: 1000 })];
    const after = [row(2, 1, "cmd.exe", { startedAt: 9999 })];
    expect(findOrphans(before, 1, after)).toEqual([]);
  });
});
