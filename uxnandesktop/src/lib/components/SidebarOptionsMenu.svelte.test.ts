/**
 * The left panel's one options menu: every panel-wide choice (new terminal and
 * its profiles, view, both sorts, hidden worktrees, refresh) reaches the store that owns it, the
 * hidden count rides on the trigger, and the whole thing works from the
 * keyboard.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { mountWithProviders } from "../../test/render";
import { app } from "$lib/state/app.svelte";
import { projects } from "$lib/state/projects.svelte";
import type { RepoData, WorktreeEntry } from "$lib/types";
import SidebarOptionsMenu from "./SidebarOptionsMenu.svelte";

const REPO: RepoData = { id: "a", name: "alpha", path: "/p/a", worktrees: [], isGit: true };
const entry = (path: string, branch: string, isMain = false): WorktreeEntry => ({
  path,
  branch,
  head: "abcdef0123456789",
  isMain,
});
const MAIN = entry("/p/a", "main", true);
const OLD = entry("/p/a--old", "old");
const OLDER = entry("/p/a--older", "older");

function setup(hidden: string[] = [], showHidden = false) {
  app.repos = [REPO];
  projects.worktreesByRepo = { a: [MAIN, OLD, OLDER] };
  projects.statusByPath = {
    [OLD.path]: { dirty: 0, ahead: 0, behind: 0 },
    [OLDER.path]: { dirty: 0, ahead: 0, behind: 0 },
  };
  projects.query = "";
  projects.activeWorktreePath = null;
  projects.pickerOpen = false;
  app.settings.sidebarGroupBy = "none";
  app.settings.projectSort = "manual";
  app.settings.worktreeSort = "manual";
  app.settings.hiddenWorktrees = hidden;
  // The worktrees of this fixture were already there: the panel has taken them in.
  app.settings.knownWorktrees = [OLD.path, OLDER.path];
  app.settings.worktreeBaselineProjects = ["a"];
  app.settings.sidebarShowHidden = showHidden;
  app.settings.pinnedWorktrees = [];
  app.settings.language = "en";
  app.settings.terminalProfiles = [];
}

const commands = { update_settings: () => ({}) };

/** Open the menu the way a keyboard user does. */
async function openMenu(
  screen: ReturnType<typeof mountWithProviders>["screen"],
  user: ReturnType<typeof mountWithProviders>["user"],
) {
  const trigger = await screen.findByRole("button", { name: /^(Panel options|Opciones del panel)/ });
  trigger.focus();
  await user.keyboard("{ArrowDown}");
  await screen.findByRole("menu", { hidden: true }, { timeout: 5000 });
  // The menu focuses its first row once it has opened; wait for that, or it
  // lands after a row the test focused and Enter picks the wrong one.
  await vi.waitFor(() => expect(document.activeElement?.getAttribute("role")).toMatch(/^menuitem/), {
    timeout: 5000,
  });
  return trigger;
}


/** A menu row by role and text. The menu stays `visibility: hidden` in jsdom
 *  (floating-ui never lays it out), which empties the accessible *name*, so the
 *  row is matched by its text instead — the role is still the assertion. */
function rows(role: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[role="${role}"]`));
}
function matches(el: HTMLElement, text: string | RegExp): boolean {
  const own = el.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return typeof text === "string" ? own === text || own.startsWith(`${text} `) : text.test(own);
}
async function menuItem(role: string, text: string | RegExp): Promise<HTMLElement> {
  return vi.waitFor(
    () => {
      const hit = rows(role).find((el) => matches(el, text));
      if (!hit) throw new Error(`no ${role} "${text}"`);
      return hit;
    },
    { timeout: 5000 },
  );
}
function queryMenuItem(role: string, text: string | RegExp): HTMLElement | null {
  return rows(role).find((el) => matches(el, text)) ?? null;
}

/** Press Enter on [row] once focus has stayed on it for a moment: on a slow
 *  runner the menu can move focus (to its first row) after the test focused
 *  this one, and Enter would then pick that row instead. */
async function activate(user: ReturnType<typeof mountWithProviders>["user"], row: HTMLElement) {
  await focusSteady(row);
  await user.keyboard("{Enter}");
}
/** Open a submenu from the keyboard, once focus has settled on its trigger. */
async function openSub(user: ReturnType<typeof mountWithProviders>["user"], row: HTMLElement) {
  await focusSteady(row);
  await user.keyboard("{ArrowRight}");
}
async function focusSteady(row: HTMLElement) {
  await vi.waitFor(
    async () => {
      row.focus();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(document.activeElement).toBe(row);
    },
    { timeout: 5000 },
  );
}

beforeEach(() => setup());

describe("SidebarOptionsMenu — trigger", () => {
  it("carries no badge while nothing is held back", async () => {
    const { screen } = mountWithProviders(SidebarOptionsMenu, { commands });

    const trigger = await screen.findByRole("button", { name: "Panel options" });
    expect(trigger).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-options-badge")).toBeNull();
  });

  it("counts what is held back, in the badge and in the accessible name", async () => {
    setup([OLD.path, OLDER.path]);
    const { screen } = mountWithProviders(SidebarOptionsMenu, { commands });

    const trigger = await screen.findByRole("button", { name: "Panel options — 2 hidden worktrees" });
    expect(trigger).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-options-badge")).toHaveTextContent("2");
  });

  it("says one hidden worktree in the singular, and in Spanish", async () => {
    setup([OLD.path]);
    const en = mountWithProviders(SidebarOptionsMenu, { commands });
    expect(
      await en.screen.findByRole("button", { name: "Panel options — 1 hidden worktree" }),
    ).toBeInTheDocument();
    en.screen.unmount();

    app.settings.language = "es";
    const es = mountWithProviders(SidebarOptionsMenu, { commands });
    expect(
      await es.screen.findByRole("button", { name: "Opciones del panel — 1 worktree oculto" }),
    ).toBeInTheDocument();
  });
});

describe("SidebarOptionsMenu — view and sort", () => {
  it("shows the current view and switches it from its submenu, by keyboard", async () => {
    const { screen, user } = mountWithProviders(SidebarOptionsMenu, { commands });
    await openMenu(screen, user);

    const view = await menuItem("menuitem", /^View/);
    expect(view).toHaveTextContent("Tree");
    await openSub(user, view);
    const status = await menuItem("menuitemradio", "By status");
    expect(await menuItem("menuitemradio", "Tree")).toHaveAttribute("aria-checked", "true");
    await activate(user, status);

    expect(app.settings.sidebarGroupBy).toBe("status");
  });

  it("shows each sort's current value and changes it in its submenu", async () => {
    app.settings.projectSort = "name-asc";
    const { screen, user } = mountWithProviders(SidebarOptionsMenu, { commands });
    await openMenu(screen, user);

    const projectsSort = await menuItem("menuitem", /Sort projects/);
    expect(projectsSort).toHaveTextContent("Name (A–Z)");
    const worktreesSort = await menuItem("menuitem", /Sort worktrees/);
    expect(worktreesSort).toHaveTextContent("Manual");

    await openSub(user, worktreesSort);
    const recent = await menuItem("menuitemradio", "Recent");
    await activate(user, recent);

    expect(app.settings.worktreeSort).toBe("recent");
    expect(app.settings.projectSort).toBe("name-asc");
  });
});

describe("SidebarOptionsMenu — hidden worktrees", () => {
  it("offers nothing about hidden worktrees until one is hidden", async () => {
    const { screen, user } = mountWithProviders(SidebarOptionsMenu, { commands });
    await openMenu(screen, user);

    expect(queryMenuItem("menuitemcheckbox", /View hidden worktrees/)).toBeNull();
    expect(queryMenuItem("menuitem", /Stop hiding/)).toBeNull();
  });

  it("names the view switch and the permanent action apart, each with its count", async () => {
    setup([OLD.path, OLDER.path]);
    const { screen, user } = mountWithProviders(SidebarOptionsMenu, { commands });
    await openMenu(screen, user);

    // A checkbox: it only looks at the hidden rows, the marks stay.
    const toggle = await menuItem("menuitemcheckbox", "View hidden worktrees (2)");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    // A plain action: it ends the hiding.
    expect(await menuItem("menuitem", "Stop hiding worktrees")).toBeInTheDocument();
  });

  it("looks at the hidden rows from the checkbox without removing a single mark", async () => {
    setup([OLD.path, OLDER.path]);
    const { screen, user } = mountWithProviders(SidebarOptionsMenu, { commands });
    await openMenu(screen, user);

    const toggle = await menuItem("menuitemcheckbox", /View hidden worktrees/);
    await activate(user, toggle);

    expect(app.settings.sidebarShowHidden).toBe(true);
    expect(app.settings.hiddenWorktrees).toEqual([OLD.path, OLDER.path]);
  });

  it("shows the checkbox as checked while hidden rows are being shown", async () => {
    setup([OLD.path, OLDER.path], true);
    const { screen, user } = mountWithProviders(SidebarOptionsMenu, { commands });
    await openMenu(screen, user);

    expect(await menuItem("menuitemcheckbox", /View hidden worktrees/)).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("stops hiding all of them for good, and stops showing hidden ones", async () => {
    setup([OLD.path, OLDER.path], true);
    const { screen, user } = mountWithProviders(SidebarOptionsMenu, { commands });
    await openMenu(screen, user);

    const all = await menuItem("menuitem", "Stop hiding worktrees");
    await activate(user, all);

    expect(app.settings.hiddenWorktrees).toEqual([]);
    expect(app.settings.sidebarShowHidden).toBe(false);
  });

  it("says the action without a count — it ends all the hiding, whatever the number", async () => {
    setup([OLD.path]);
    const { screen, user } = mountWithProviders(SidebarOptionsMenu, { commands });
    await openMenu(screen, user);

    expect(await menuItem("menuitem", "Stop hiding worktrees")).toBeInTheDocument();
    expect(await menuItem("menuitemcheckbox", "View hidden worktrees (1)")).toBeInTheDocument();
  });

  it("says both in Spanish", async () => {
    setup([OLD.path, OLDER.path]);
    app.settings.language = "es";
    const { screen, user } = mountWithProviders(SidebarOptionsMenu, { commands });
    await openMenu(screen, user);

    expect(await menuItem("menuitemcheckbox", "Ver worktrees ocultos (2)")).toBeInTheDocument();
    expect(await menuItem("menuitem", "Dejar de ocultar worktrees")).toBeInTheDocument();
  });

  it("quiets the badge once the hidden worktrees are being shown", async () => {
    setup([OLD.path], true);
    const { screen } = mountWithProviders(SidebarOptionsMenu, { commands });

    const badge = await screen.findByTestId("sidebar-options-badge");
    expect(badge.className).not.toContain("bg-primary");
    expect(badge).toHaveTextContent("1");
  });
});

describe("SidebarOptionsMenu — worktrees created outside Uxnan", () => {
  const SCRATCH = entry("/p/a/.claude/worktrees/scratch", "scratch");
  const clean = { dirty: 0, ahead: 0, behind: 0 };

  /** A project with a worktree an agent made with plain git, nothing hidden by hand. */
  function withScratch() {
    setup();
    projects.worktreesByRepo = { a: [MAIN, SCRATCH] };
    projects.statusByPath = { [SCRATCH.path]: clean };
    app.settings.knownWorktrees = [];
    app.settings.worktreeBaselineProjects = ["a"];
    projects.notePr(SCRATCH.path, null);
  }

  it("counts it on the trigger and in the menu although the user hid nothing", async () => {
    withScratch();
    const { screen, user } = mountWithProviders(SidebarOptionsMenu, { commands });

    expect(await screen.findByRole("button", { name: "Panel options — 1 hidden worktree" })).toBeInTheDocument();
    await openMenu(screen, user);
    expect(await menuItem("menuitemcheckbox", "View hidden worktrees (1)")).toBeInTheDocument();
    expect(await menuItem("menuitem", "Stop hiding worktrees")).toBeInTheDocument();
  });

  it("is taken in by 'Stop hiding worktrees', and stays in the list", async () => {
    withScratch();
    const { screen, user } = mountWithProviders(SidebarOptionsMenu, { commands });
    await openMenu(screen, user);

    await activate(user, await menuItem("menuitem", "Stop hiding worktrees"));

    expect(app.settings.knownWorktrees).toEqual([SCRATCH.path]);
    expect(projects.isExternal(SCRATCH.path)).toBe(false);
    expect(projects.hiddenCount).toBe(0);
  });

  it("offers no hidden-worktree controls when nothing is set aside", async () => {
    withScratch();
    app.settings.knownWorktrees = [SCRATCH.path];
    const { screen, user } = mountWithProviders(SidebarOptionsMenu, { commands });
    await openMenu(screen, user);

    expect(queryMenuItem("menuitem", "Stop hiding worktrees")).toBeNull();
  });
});

describe("SidebarOptionsMenu — panel actions", () => {
  it("does not carry Add project: that stays a visible header button", async () => {
    const { screen, user } = mountWithProviders(SidebarOptionsMenu, { commands });
    await openMenu(screen, user);

    expect(queryMenuItem("menuitem", /Add project/)).toBeNull();
  });

  it("reloads the worktrees from Refresh", async () => {
    const init = vi.spyOn(projects, "init").mockResolvedValue(undefined);
    try {
      const { screen, user } = mountWithProviders(SidebarOptionsMenu, { commands });
      await openMenu(screen, user);

      const refresh = await menuItem("menuitem", /Refresh worktrees/);
      await activate(user, refresh);

      expect(init).toHaveBeenCalledTimes(1);
    } finally {
      init.mockRestore();
    }
  });
});

describe("SidebarOptionsMenu — new terminal", () => {
  it("opens the default shell from New terminal, with its shortcut shown", async () => {
    const open = vi.spyOn(app, "openTerminal").mockImplementation(() => undefined as never);
    try {
      const { screen, user } = mountWithProviders(SidebarOptionsMenu, { commands });
      await openMenu(screen, user);

      const item = await menuItem("menuitem", /^New terminal/);
      expect(item.querySelector("kbd")).not.toBeNull();
      await activate(user, item);

      expect(open).toHaveBeenCalledWith();
    } finally {
      open.mockRestore();
    }
  });

  it("offers no profile submenu until a profile is configured", async () => {
    app.settings.terminalProfiles = [];
    const { screen, user } = mountWithProviders(SidebarOptionsMenu, { commands });
    await openMenu(screen, user);

    expect(queryMenuItem("menuitem", /Choose a terminal profile/)).toBeNull();
  });

  it("opens a terminal in a chosen profile from its submenu", async () => {
    app.settings.terminalProfiles = [
      { id: "wsl", name: "Ubuntu", command: "wsl.exe", args: ["-d", "Ubuntu"] },
      { id: "blank", name: " ", command: "pwsh", args: [] },
    ];
    const open = vi.spyOn(app, "openTerminal").mockImplementation(() => undefined as never);
    try {
      const { screen, user } = mountWithProviders(SidebarOptionsMenu, { commands });
      await openMenu(screen, user);

      const sub = await menuItem("menuitem", /Choose a terminal profile/);
      await openSub(user, sub);
      // A profile with no name is still a row, under its placeholder.
      await menuItem("menuitem", "Unnamed profile");
      const ubuntu = await menuItem("menuitem", "Ubuntu");
      await activate(user, ubuntu);

      expect(open).toHaveBeenCalledWith({ profileId: "wsl" });
    } finally {
      open.mockRestore();
      app.settings.terminalProfiles = [];
    }
  });
});
