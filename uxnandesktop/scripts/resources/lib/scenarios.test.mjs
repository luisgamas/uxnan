import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { autoScenarioIds, getScenario, SCENARIOS } from "./scenarios.mjs";
import { isShell } from "./tree.mjs";
import {
  liveTerminalCount,
  STATE_SCHEMA_VERSION,
  terminalGrid,
  terminalTab,
  writeProfile,
} from "./profile.mjs";
import { SCENARIO_IDS } from "./schema.mjs";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "uxnan-bench-test-"));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

/** Count the regions in a layout tree — one live PTY each. */
function countRegions(node) {
  if (!node) return 0;
  return node.type === "group" ? 1 : countRegions(node.a) + countRegions(node.b);
}

const FIXTURES = {
  repo: { dir: path.join(TMP, "repo"), head: "0".repeat(40), files: 200 },
  http: { url: "http://127.0.0.1:1234/" },
};

describe("the scenario table", () => {
  it("covers exactly the scenario ids the schema accepts", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(SCENARIO_IDS);
  });

  it("gives every scenario a question, a mode and a measurement window", () => {
    for (const s of SCENARIOS) {
      expect(s.question, `${s.id} has no question`).toBeTruthy();
      expect(["auto", "assisted"]).toContain(s.mode);
      expect(s.defaults.durationS).toBeGreaterThan(0);
      expect(s.defaults.stabilizeS).toBeGreaterThanOrEqual(0);
      expect(
        s.defaults.stabilizeS,
        `${s.id} discards more than it measures`,
      ).toBeLessThan(s.defaults.durationS);
    }
  });

  it("marks the account-dependent scenario as operator-driven, never automatic", () => {
    // R08 needs a real `gh` login; CI must never be handed one.
    expect(getScenario("R08").mode).toBe("assisted");
    expect(autoScenarioIds()).not.toContain("R08");
  });

  it("names the scenario each delta is meaningful against", () => {
    expect(getScenario("R03").baseline).toBe("R02");
    expect(getScenario("R04").baseline).toBe("R03");
  });

  it("rejects an unknown id with the list of known ones", () => {
    expect(() => getScenario("R42")).toThrow(/unknown scenario R42/);
  });
});

describe("scenario preparation", () => {
  it("R00 seeds an empty profile", () => {
    const prepared = getScenario("R00").prepare({ fixtures: {} });
    expect(prepared.repos).toEqual([]);
    expect(prepared.layout).toBeNull();
  });

  it("R02 and R03 differ only in the number of live regions", () => {
    const one = getScenario("R02").prepare({ fixtures: FIXTURES });
    const four = getScenario("R03").prepare({ fixtures: FIXTURES });
    expect(countRegions(one.layout.workspaces[FIXTURES.repo.dir])).toBe(1);
    expect(countRegions(four.layout.workspaces[FIXTURES.repo.dir])).toBe(4);
  });

  it("R04 restores the same four regions asleep", () => {
    const prepared = getScenario("R04").prepare({ fixtures: FIXTURES });
    const tree = prepared.layout.workspaces[FIXTURES.repo.dir];
    expect(countRegions(tree)).toBe(4);
    const tabs = [];
    (function walk(n) {
      if (n.type === "group") tabs.push(...n.tabs);
      else {
        walk(n.a);
        walk(n.b);
      }
    })(tree);
    expect(tabs.every((t) => t.asleep === true)).toBe(true);
  });

  it("R05 launches the offline fixture agent, not a real CLI", () => {
    const prepared = getScenario("R05").prepare({ fixtures: FIXTURES });
    const tab = prepared.layout.workspaces[FIXTURES.repo.dir].tabs[0];
    expect(tab.args.join(" ")).toMatch(/agent-fixture\.mjs/);
  });

  it("R05 runs the agent inside a shell, which is what makes its cost external", () => {
    // Launched *as* the shell, the fixture would be a direct child of the app
    // and land in `managed` — uxnan would be charged for the agent's memory.
    const prepared = getScenario("R05").prepare({ fixtures: FIXTURES });
    const tab = prepared.layout.workspaces[FIXTURES.repo.dir].tabs[0];
    expect(isShell(tab.shell)).toBe(true);
    expect(tab.shell).not.toBe(process.execPath);
    // …and the shell outlives the command, so the tab still holds a terminal
    // for the rest of the measurement window.
    expect(tab.args.join(" ")).toMatch(process.platform === "win32" ? /^\/k / : /exec \/bin\/sh$/);
  });

  it("R09 varies only the pet settings across its variants", () => {
    const scenario = getScenario("R09");
    const off = scenario.prepare({ fixtures: FIXTURES, variant: "off" });
    const layer = scenario.prepare({ fixtures: FIXTURES, variant: "layer" });
    const overlay = scenario.prepare({ fixtures: FIXTURES, variant: "overlay" });
    expect(off.settingsOverrides.pets).toEqual({ enabled: false, overlay: false });
    expect(layer.settingsOverrides.pets).toEqual({ enabled: true, overlay: false });
    expect(overlay.settingsOverrides.pets).toEqual({ enabled: true, overlay: true });
  });

  it("R11 asks for a warm-up launch, because a restore needs something to restore", () => {
    expect(getScenario("R11").warmup).toBe(true);
  });

  it("R12 varies only the resource-monitor settings across its variants", () => {
    const scenario = getScenario("R12");
    const off = scenario.prepare({ fixtures: FIXTURES, variant: "off" });
    const parked = scenario.prepare({ fixtures: FIXTURES, variant: "parked" });
    const sweep = scenario.prepare({ fixtures: FIXTURES, variant: "sweep" });
    expect(off.settingsOverrides.resources).toEqual({
      enabled: false,
      orphanSweep: false,
      orphanSweepSeconds: 15,
    });
    expect(parked.settingsOverrides.resources).toEqual({
      enabled: true,
      orphanSweep: false,
      orphanSweepSeconds: 15,
    });
    expect(sweep.settingsOverrides.resources).toEqual({
      enabled: true,
      orphanSweep: true,
      orphanSweepSeconds: 15,
    });
    // Same one-shell layout as its R02 baseline, so the delta means something.
    expect(scenario.baseline).toBe("R02");
    expect(countRegions(parked.layout.workspaces[FIXTURES.repo.dir])).toBe(1);
  });
});

describe("profile seeding", () => {
  it("writes a state document with the fields the app requires", () => {
    const dir = writeProfile(path.join(TMP, "profile"), {
      repos: [],
      layout: null,
    });
    const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
    expect(state.version).toBe(STATE_SCHEMA_VERSION);
    expect(state.settings.theme).toBe("system");
    expect(state.settings.leftSidebarWidth).toBeTypeOf("number");
  });

  it("turns off everything a resting measurement must not include", () => {
    const dir = writeProfile(path.join(TMP, "profile-quiet"), {});
    const { settings } = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
    expect(settings.updater.autoCheck).toBe(false);
    expect(settings.usageProviders).toEqual([]);
    expect(settings.pets.enabled).toBe(false);
    // Installing hook configs would write outside the scenario's own directory.
    expect(settings.autoInstallHooks).toBe(false);
  });

  it("builds a balanced grid, so four terminals are four regions", () => {
    const tree = terminalGrid(4, (i) => terminalTab({ title: `t${i}` }));
    expect(countRegions(tree)).toBe(4);
    expect(tree.type).toBe("split");
    expect(tree.dir).toBe("row");
    expect(tree.a.dir).toBe("col");
  });

  it("collapses to a single group for one terminal", () => {
    expect(terminalGrid(1, () => terminalTab({})).type).toBe("group");
  });
});

describe("liveTerminalCount — what the harness asserts against", () => {
  const count = (id, variant) =>
    liveTerminalCount(getScenario(id).prepare({ fixtures: FIXTURES, variant }).layout);

  it("matches what each scenario seeds", () => {
    expect(count("R00")).toBe(0); // no layout at all
    expect(count("R01")).toBe(0); // a project, but no terminal
    expect(count("R02")).toBe(1);
    expect(count("R03")).toBe(4);
    expect(count("R05")).toBe(1);
    expect(count("R06")).toBe(1);
    expect(count("R10")).toBe(2);
    expect(count("R11")).toBe(4);
  });

  it("counts a sleeping workspace as zero live shells", () => {
    // R04 restores four regions asleep: the PTYs are exactly what sleep gives
    // back, so expecting them would fail every run.
    expect(count("R04")).toBe(0);
  });

  it("counts only the active tab of a region", () => {
    const doc = { active: "", workspaces: { "": { type: "group", tabs: [terminalTab({}), terminalTab({})], activeTab: 0 } } };
    expect(liveTerminalCount(doc)).toBe(1);
  });

  it("ignores a workspace that is not the active one", () => {
    const doc = {
      active: "a",
      workspaces: {
        a: { type: "group", tabs: [terminalTab({})], activeTab: 0 },
        b: { type: "group", tabs: [terminalTab({}), terminalTab({})], activeTab: 0 },
      },
    };
    expect(liveTerminalCount(doc)).toBe(1);
  });

  it("is zero for no layout", () => {
    expect(liveTerminalCount(null)).toBe(0);
  });
});
