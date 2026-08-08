/**
 * Settings → Appearance → Terminal, the Bold-text switch.
 *
 * The contract worth pinning is what "bold" is allowed to touch: the weight, and
 * only the weight — the family, size, line-height and spacing the user picked
 * must come out the other side untouched. The switch also reads the *effective*
 * weight rather than its own override, so a preset that is already bold shows as
 * on; that is what makes turning it off write an explicit regular weight instead
 * of clearing the override back onto a bold preset.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { mount } from "../../test/render";
import { app } from "$lib/state/app.svelte";
import ThemeSettings from "./ThemeSettings.svelte";

beforeEach(() => {
  // A bits-ui modal left open by an earlier test leaves `pointer-events: none`
  // on the body and blocks every later click (same leak the app guards at runtime).
  document.body.style.pointerEvents = "";
  app.previewTerminalTheme = null;
  app.previewTheme = null;
  app.settings.terminalFonts = {};
  app.settings.terminalThemes = [];
  app.settings.terminalThemeMode = "single";
  app.settings.activeTerminalThemeId = "inherit";
  app.settings.activeThemeId = "dark";
});

function commands() {
  return {
    update_settings: () => ({ version: 1, repos: [], settings: {}, agentCache: [] }),
    list_system_fonts: () => [] as string[],
  };
}

function boldSwitch(screen: ReturnType<typeof mount>["screen"]) {
  return screen.getByRole("switch", { name: "Bold text" });
}

describe("ThemeSettings — Bold text", () => {
  it("is off while the terminal inherits the regular weight", () => {
    const { screen } = mount(ThemeSettings, { commands: commands() });
    expect(boldSwitch(screen)).not.toBeChecked();
  });

  it("turns the terminal bold without touching the rest of the typography", async () => {
    app.settings.terminalFonts = { fontFamily: "JetBrains Mono", fontSize: 13, letterSpacing: 0.5 };
    const { screen, user } = mount(ThemeSettings, { commands: commands() });

    await user.click(boldSwitch(screen));

    expect(app.settings.terminalFonts).toEqual({
      fontFamily: "JetBrains Mono",
      fontSize: 13,
      letterSpacing: 0.5,
      fontWeight: 700,
    });
    expect(app.resolveTerminal().fontFamily).toContain("JetBrains Mono");
    expect(app.resolveTerminal().fontSize).toBe(13);
  });

  it("keeps program-bold output heavier than the body weight", async () => {
    const { screen, user } = mount(ThemeSettings, { commands: commands() });
    expect(app.resolveTerminal()).toMatchObject({ fontWeight: 300, fontWeightBold: 700 });

    await user.click(boldSwitch(screen));

    expect(app.resolveTerminal()).toMatchObject({ fontWeight: 700, fontWeightBold: 900 });
  });

  it("clears the override when switched back off", async () => {
    app.settings.terminalFonts = { fontWeight: 700 };
    const { screen, user } = mount(ThemeSettings, { commands: commands() });
    expect(boldSwitch(screen)).toBeChecked();

    await user.click(boldSwitch(screen));

    expect(app.settings.terminalFonts?.fontWeight).toBeUndefined();
    expect(app.resolveTerminal().fontWeight).toBe(300);
  });

  it("reads a bold preset as on, and switching off writes an explicit regular weight", async () => {
    app.settings.terminalThemes = [{ id: "t1", name: "Heavy", base: "dark", fontWeight: "bold" }];
    app.settings.activeTerminalThemeId = "t1";
    const { screen, user } = mount(ThemeSettings, { commands: commands() });
    expect(boldSwitch(screen)).toBeChecked();

    await user.click(boldSwitch(screen));

    // Clearing the override would fall straight back onto the preset's bold.
    expect(app.settings.terminalFonts?.fontWeight).toBe(400);
    expect(app.resolveTerminal().fontWeight).toBe(400);
  });
});
