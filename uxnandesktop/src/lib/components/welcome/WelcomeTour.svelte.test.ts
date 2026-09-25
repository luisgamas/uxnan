/**
 * The welcome tour: shown once (per tour version), walked with the buttons or
 * the arrows, recorded as seen when finished or skipped.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mountWithProviders, until } from "../../../test/render";
import { app } from "$lib/state/app.svelte";
import { welcome, WELCOME_VERSION } from "$lib/state/welcome.svelte";
import WelcomeTour from "./WelcomeTour.svelte";

const settingsCall = () => ({ version: 1, repos: [], settings: {}, agentCache: [] });

afterEach(() => {
  welcome.open = false;
  app.settings.welcomeSeen = undefined;
});

describe("welcome", () => {
  it("shows once per tour version", () => {
    app.settings.welcomeSeen = undefined;
    welcome.showIfNew();
    expect(welcome.open).toBe(true);
    welcome.open = false;
    app.settings.welcomeSeen = WELCOME_VERSION;
    welcome.showIfNew();
    expect(welcome.open).toBe(false);
  });

  it("walks the steps and records the tour as seen when it ends", async () => {
    welcome.show();
    const { screen, user, backend } = mountWithProviders(WelcomeTour, {
      commands: { agents_detect: () => ["claude"], update_settings: settingsCall },
    });
    expect(screen.getByText("Every coding agent, in one place.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Terminal or chat — your call.")).toBeTruthy();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("Your phone, in the same conversation.")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Your agents." }));
    await until(() => screen.queryByText("claude") !== null);
    await user.click(screen.getByRole("tab", { name: "You're ready." }));
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(welcome.open).toBe(false);
    expect(app.settings.welcomeSeen).toBe(WELCOME_VERSION);
    await until(() => backend.called("update_settings"));
  });

  it("skipping counts as seen", async () => {
    welcome.show();
    const { screen, user } = mountWithProviders(WelcomeTour, {
      commands: { agents_detect: () => [], update_settings: settingsCall },
    });
    await user.click(screen.getByRole("button", { name: "Skip" }));
    expect(welcome.open).toBe(false);
    expect(app.settings.welcomeSeen).toBe(WELCOME_VERSION);
  });
});
