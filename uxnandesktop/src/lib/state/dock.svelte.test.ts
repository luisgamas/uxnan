import { beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "./app.svelte";
import { terminals } from "./terminals.svelte";
import { dock, dockSurfaces, pruneRemembered, MAX_REMEMBERED } from "./dock.svelte";
import { surfaceBadge } from "$lib/dockSurfaces";
import type { DockWorkspace } from "$lib/types";

const base = { project: true, git: true, local: true, githubEnabled: true, browserEnabled: true };

describe("dockSurfaces", () => {
  it("gives a local git project every surface, in dock order", () => {
    expect(dockSurfaces(base)).toEqual(["files", "git", "github", "browser"]);
  });

  it("gives a plain folder no Git and no GitHub", () => {
    expect(dockSurfaces({ ...base, git: false })).toEqual(["files", "browser"]);
  });

  it("gives the Global space only the browser", () => {
    expect(dockSurfaces({ ...base, project: false, git: false })).toEqual(["browser"]);
  });

  it("gives a project on a host no GitHub, and follows the settings", () => {
    expect(dockSurfaces({ ...base, local: false })).toEqual(["files", "git", "browser"]);
    expect(dockSurfaces({ ...base, githubEnabled: false })).toEqual(["files", "git", "browser"]);
    expect(dockSurfaces({ ...base, browserEnabled: false })).toEqual(["files", "git", "github"]);
    expect(dockSurfaces({ ...base, project: false, browserEnabled: false })).toEqual([]);
  });
});

describe("pruneRemembered", () => {
  const entry = (touched: number): DockWorkspace => ({
    open: true,
    surface: "files",
    gitView: "changes",
    touched,
  });

  it("keeps everything under the cap", () => {
    const entries = { a: entry(1), b: entry(2) };
    expect(pruneRemembered(entries, 3)).toBe(entries);
  });

  it("drops the least recently used past the cap", () => {
    const kept = pruneRemembered({ a: entry(1), b: entry(5), c: entry(3) }, 2);
    expect(Object.keys(kept).sort()).toEqual(["b", "c"]);
  });

  it("caps at a few hundred by default", () => {
    expect(MAX_REMEMBERED).toBe(200);
  });
});

describe("surfaceBadge", () => {
  const none = { changes: 0, checks: null, approval: false };

  it("counts changes on Git, and says nothing for a clean tree", () => {
    expect(surfaceBadge("git", { ...none, changes: 4 })).toEqual({ kind: "count", value: 4 });
    expect(surfaceBadge("git", none)).toBeNull();
  });

  it("shows the pull request's checks on GitHub", () => {
    expect(surfaceBadge("github", { ...none, checks: "failure" })).toEqual({ kind: "dot", tone: "failure" });
    expect(surfaceBadge("github", { ...none, checks: "none" })).toBeNull();
    expect(surfaceBadge("github", none)).toBeNull();
  });

  it("flags a waiting approval on the browser, and nothing on Files", () => {
    expect(surfaceBadge("browser", { ...none, approval: true })).toEqual({ kind: "dot", tone: "attention" });
    expect(surfaceBadge("files", { changes: 9, checks: "success", approval: true })).toBeNull();
  });
});

describe("the dock, per workspace", () => {
  beforeEach(() => {
    vi.spyOn(app, "persistSettings").mockResolvedValue();
    app.settings.dock = { workspaces: {} };
    app.settings.browser = { ...app.settings.browser!, enabled: true };
    // The Global space: no project, so only the browser.
    terminals.setWorkspace("");
  });

  it("starts closed", () => {
    expect(dock.isOpen()).toBe(false);
    expect(dock.showing()).toBeNull();
  });

  it("opens on a surface, remembers it, and persists", () => {
    dock.show("browser");
    expect(dock.showing()).toBe("browser");
    expect(app.settings.dock?.workspaces[""]).toMatchObject({ open: true, surface: "browser" });
    expect(app.persistSettings).toHaveBeenCalled();
  });

  it("opens on its chooser until something is picked", () => {
    dock.toggle();
    expect(dock.isOpen()).toBe(true);
    expect(dock.surfaceOf()).toBeNull();
    expect(dock.showing()).toBeNull();
  });

  it("toggles open and closed, and reopens on the surface it showed", () => {
    dock.show("browser");
    dock.toggle();
    expect(dock.isOpen()).toBe(false);
    dock.toggle();
    expect(dock.showing()).toBe("browser");
  });

  it("brings the chooser back for a remembered surface the workspace lost", () => {
    // The Global space has no Git: a remembered Git surface is not shown.
    app.settings.dock = {
      workspaces: { "": { open: true, surface: "git", gitView: "changes", touched: 1 } },
    };
    expect(dock.isOpen()).toBe(true);
    expect(dock.surfaceOf()).toBeNull();
  });

  it("keeps each workspace's dock apart", () => {
    dock.show("browser", "/work/other");
    expect(dock.showing("/work/other")).toBe("browser");
    expect(dock.isOpen()).toBe(false);
    dock.hide("/work/other");
    expect(dock.isOpen("/work/other")).toBe(false);
  });

  it("remembers the Git view", () => {
    dock.showGit("history", "/work/repo");
    expect(dock.gitView("/work/repo")).toBe("history");
    expect(dock.showing("/work/repo")).toBe("git");
  });
});
