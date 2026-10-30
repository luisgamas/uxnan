/**
 * The welcome tour: shown once (per tour version), walked with the buttons or
 * the arrows, recorded as seen when finished or skipped.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mountWithProviders, until } from "../../../test/render";
import { app } from "$lib/state/app.svelte";
import { welcome, WELCOME_VERSION } from "$lib/state/welcome.svelte";
import WelcomeTour from "./WelcomeTour.svelte";
import MockDesktop from "./mock/MockDesktop.svelte";
import MockPhone from "./mock/MockPhone.svelte";

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
      commands: { agents_detect: () => [], update_settings: settingsCall },
    });
    expect(screen.getByText("Every coding agent, in one place.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Chat or terminal — and it follows you.")).toBeTruthy();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("Reach this computer from anywhere.")).toBeTruthy();
    expect(screen.getByText("Your own relay")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "You're ready." }));
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(welcome.open).toBe(false);
    expect(app.settings.welcomeSeen).toBe(WELCOME_VERSION);
    await until(() => backend.called("update_settings"));
  });

  it("turns on the agents found here, every one checked unless unchecked", async () => {
    app.settings.agentProfiles = [];
    welcome.show();
    const { screen, user } = mountWithProviders(WelcomeTour, {
      commands: { agents_detect: () => ["claude", "codex"], update_settings: settingsCall },
    });
    await user.click(screen.getByRole("tab", { name: "Turn on your agents." }));
    await until(() => screen.queryByText("claude") !== null);
    expect(screen.getByRole("button", { name: "Turn on 2 and continue" })).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "Codex" }));
    await user.click(screen.getByRole("button", { name: "Turn on 1 and continue" }));
    expect(app.settings.agentProfiles.map((p) => p.command)).toEqual(["claude"]);
    expect(screen.getByText("Pair your phone.")).toBeTruthy();
    app.settings.agentProfiles = [];
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

describe("the tour's mockups", () => {
  it("speak the app's language", () => {
    const previous = app.settings.language;
    app.settings.language = "es";
    try {
      const phone = mountWithProviders(MockPhone, { props: { screen: "threads" } });
      expect(phone.screen.getByText("Nueva conversación")).toBeTruthy();
      const desktop = mountWithProviders(MockDesktop, { props: { center: "chat" } });
      expect(desktop.screen.getByText("Buscar un proyecto…")).toBeTruthy();
      expect(desktop.screen.getAllByText("Esperando tu respuesta").length).toBeGreaterThan(0);
    } finally {
      app.settings.language = previous;
    }
  });
});
