import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = (name: string) =>
  readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

describe("phase-five chrome and dialog contracts", () => {
  it("uses native macOS traffic lights without losing quick commands", () => {
    const controls = component("WindowControls.svelte");
    expect(controls.indexOf("<QuickCommandsMenu />")).toBeLessThan(
      controls.indexOf("{#if !isMac}"),
    );
    expect(controls).toContain("iconSize.windowMaximize");
    expect(component("LeftSidebar.svelte")).toContain("shell.macTrafficLightsInset");

    const config = JSON.parse(
      readFileSync(
        new URL("../../../src-tauri/tauri.macos.conf.json", import.meta.url),
        "utf8",
      ),
    );
    const window = config.app.windows[0];
    expect(window.decorations).toBe(true);
    expect(window.titleBarStyle).toBe("Overlay");
    expect(window.hiddenTitle).toBe(true);
  });

  it("keeps full-screen back buttons in the shared workspace header", () => {
    for (const name of ["Settings.svelte", "Automations.svelte"]) {
      const source = component(name);
      expect(source, name).toContain("<WorkspaceAppBar");
    }
    const workspace = component("WorkspaceAppBar.svelte");
    expect(workspace).toContain("shell.workspaceHeader");
    expect(workspace).toContain("shell.macTrafficLightsInset");
    expect(workspace).toContain("class={shell.appBarAction}");
  });

  it("keeps every top-level appbar on one shared height", () => {
    const design = readFileSync(new URL("../design.ts", import.meta.url), "utf8");
    expect(design).toMatch(/appBar:[\s\S]*?h-10[\s\S]*?after:bottom-0/);
    expect(design).toMatch(/appBarOverlay: [^\n]*h-10/);
    expect(design).toMatch(/appBarAction: [^\n]*size-10/);
    expect(design).toMatch(/appBarCompactAction: [^\n]*size-10/);
    expect(design).toMatch(/titlebarControl: [^\n]*size-10/);

    for (const name of [
      "LeftSidebar.svelte",
      "TerminalArea.svelte",
      "RightPanel.svelte",
      "WorkspaceAppBar.svelte",
    ]) {
      expect(component(name), name).toContain("shell.appBar");
    }
    const controls = component("WindowControls.svelte");
    expect(controls).toContain("shell.appBarOverlay");
    expect(controls).not.toContain("shell.appBar, shell.titlebar");
    const terminal = component("TerminalArea.svelte");
    expect(terminal.match(/shell\.appBarCompactAction/g)?.length).toBe(4);
    expect(terminal).toContain("iconButton.tabClose");
    expect(terminal).not.toContain("iconButton.xs");
  });

  it("gives search and profile dialogs the shared comfortable geometry", () => {
    const search = component("WorktreeSearch.svelte");
    expect(search).toContain("px-5 py-4 pr-12");
    expect(search).toContain("<DialogHints />");
    const hints = component("DialogHints.svelte");
    expect(hints).toContain("dialog.footerSurface");
    expect(hints).toContain("text-xs");
    expect(component("SidebarProfileDialog.svelte")).toContain(
      '<Dialog.Content size="form">',
    );
  });

  it("keeps terminal close controls compact without changing their style", () => {
    const terminal = component("TerminalArea.svelte");
    expect(terminal).toContain("iconButton.tabClose");
    expect(terminal).toContain("hover:bg-destructive/20");
  });

  it("synchronizes the native time affordance with the app theme", () => {
    const css = readFileSync(new URL("../../app.css", import.meta.url), "utf8");
    expect(css).toContain('input[type="time"]');
    expect(css).toContain("color-scheme: light");
    expect(css).toContain("color-scheme: dark");
  });
});
