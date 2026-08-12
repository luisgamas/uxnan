/**
 * Settings → Git → Worktree location. What matters here: it is an ordinary
 * settings row with a select (not a screen of cards), the row states the shape
 * the chosen layout produces, picking one persists it, the custom root appears
 * only for the layout that has one, and the surface is localized (EN/ES).
 */

import { beforeEach, describe, expect, it } from "vitest";

import { mountWithProviders, until } from "../../test/render";
import { app } from "$lib/state/app.svelte";
import GitSettings from "./GitSettings.svelte";

function baseCommands(identity: Record<string, unknown> = IDENTITY) {
  return {
    update_settings: () => ({ version: 1, repos: [], settings: {}, agentCache: [] }),
    git_identity: () => identity,
  };
}

const IDENTITY = {
  name: "Ada Lovelace",
  email: "ada@example.org",
  defaultBranch: "main",
  version: "2.45.1",
};

/** The worktree settings of the last persist call. */
function lastSent(backend: {
  lastCallTo(cmd: string): { args: Record<string, unknown> } | undefined;
}) {
  const args = backend.lastCallTo("update_settings")?.args as
    | { settings: Record<string, unknown> }
    | undefined;
  return (args?.settings?.worktrees ?? {}) as { location?: string; root?: string | null };
}

beforeEach(() => {
  document.body.style.pointerEvents = "";
  app.settings.language = "en";
  app.settings.worktrees = { location: "managed", root: null };
});

describe("GitSettings — identity", () => {
  it("shows who commits are authored as, and the two git facts around it", async () => {
    const { screen } = mountWithProviders(GitSettings, { commands: baseCommands() });
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@example.org")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("2.45.1")).toBeInTheDocument();
  });

  it("says an unset identity is unset, and why that matters", async () => {
    const { screen } = mountWithProviders(GitSettings, { commands: baseCommands({}) });
    expect(await screen.findByText(/git refuses to commit/)).toBeInTheDocument();
    // Two rows unset (name + email); the default branch falls back to git's own.
    expect(screen.getAllByText("Not set")).toHaveLength(2);
    expect(screen.getByText("master")).toBeInTheDocument();
    expect(screen.getByText("Not found")).toBeInTheDocument();
  });
});

describe("GitSettings — worktree location", () => {
  it("is one settings row, showing the shape the layout produces", () => {
    const { screen } = mountWithProviders(GitSettings, { commands: baseCommands() });
    expect(screen.getByText("Worktree location")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Layout" })).toBeInTheDocument();
    expect(screen.getByText("~/uxnan/worktrees/<project>/<branch>")).toBeInTheDocument();
  });

  it("renders localized in Spanish", () => {
    app.settings.language = "es";
    const { screen } = mountWithProviders(GitSettings, { commands: baseCommands() });
    expect(screen.getByText("Ubicación de los worktrees")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disposición" })).toBeInTheDocument();
  });

  it("picking a layout persists it and restates the shape", async () => {
    const { screen, backend, user } = mountWithProviders(GitSettings, {
      commands: baseCommands(),
    });
    await user.click(screen.getByRole("button", { name: "Layout" }));
    // bits-ui parks `pointer-events: none` on the body while the listbox is
    // open; jsdom keeps it, and userEvent then refuses to click the option.
    document.body.style.pointerEvents = "";
    await user.click(await screen.findByText("Beside the project"));
    await until(() => backend.called("update_settings"), { label: "layout persisted" });
    expect(lastSent(backend).location).toBe("sibling");
    expect(screen.getByText("<repository>/../<project>--<branch>")).toBeInTheDocument();
  });

  it("asks for a root only in the layout that has one, and persists what is typed", async () => {
    const { screen, backend, user } = mountWithProviders(GitSettings, {
      commands: baseCommands(),
    });
    // Managed and sibling both resolve their own root: no field to fill in.
    expect(screen.queryByLabelText("Worktree folder")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Layout" }));
    // bits-ui parks `pointer-events: none` on the body while the listbox is
    // open; jsdom keeps it, and userEvent then refuses to click the option.
    document.body.style.pointerEvents = "";
    await user.click(await screen.findByText("Custom folder"));
    const input = await screen.findByLabelText("Worktree folder");
    await user.type(input, "D:/trees");
    await until(() => lastSent(backend).root === "D:/trees", { label: "root persisted" });
    expect(lastSent(backend).location).toBe("custom");
  });
});
