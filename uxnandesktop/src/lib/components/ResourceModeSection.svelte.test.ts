/**
 * Settings → Resources → Resource mode. What matters here: the preset picker
 * is a real radio group (accessible names, keyboard selection), the effects
 * view states what the RESOLVED policy will do (overrides included, marked),
 * overrides persist normalized and "use preset" / reset truly remove them, and
 * the whole surface is localized (EN/ES).
 */

import { beforeEach, describe, expect, it } from "vitest";

import { mountWithProviders, until } from "../../test/render";
import { app } from "$lib/state/app.svelte";
import ResourceModeSection from "./ResourceModeSection.svelte";

function baseCommands() {
  return {
    update_settings: () => ({ version: 1, repos: [], settings: {}, agentCache: [] }),
  };
}

/** The settings snapshot of the last persist call. */
function lastSent(backend: { lastCallTo(cmd: string): { args: Record<string, unknown> } | undefined }) {
  return (lastCallArgs(backend)?.settings ?? {}) as {
    resourceMode?: {
      profile?: string;
      overrides?: Record<string, unknown>;
      autoSleep?: boolean;
      schemaVersion?: number;
    };
  };
}
function lastCallArgs(backend: {
  lastCallTo(cmd: string): { args: Record<string, unknown> } | undefined;
}) {
  return backend.lastCallTo("update_settings")?.args as
    | { settings: Record<string, unknown> }
    | undefined;
}

beforeEach(() => {
  document.body.style.pointerEvents = "";
  app.settings.language = "en";
  app.settings.resourceMode = { profile: "balanced", overrides: {}, autoSleep: false, schemaVersion: 1 };
});

describe("ResourceModeSection", () => {
  it("renders the three presets as an accessible radio group (EN)", () => {
    const { screen } = mountWithProviders(ResourceModeSection, { commands: baseCommands() });
    const group = screen.getByRole("radiogroup", { name: "Resource profile" });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /Balanced/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Efficient/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("renders localized in Spanish", () => {
    app.settings.language = "es";
    const { screen } = mountWithProviders(ResourceModeSection, { commands: baseCommands() });
    expect(screen.getByRole("radio", { name: /Equilibrado/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Eficiente/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Rendimiento/ })).toBeInTheDocument();
    expect(screen.getByText("Qué hace este preset")).toBeInTheDocument();
  });

  it("selecting a preset persists it and updates the effects view", async () => {
    const { screen, backend, user } = mountWithProviders(ResourceModeSection, {
      commands: baseCommands(),
    });
    // Balanced first: the sweep line shows the pre-mode 15 s.
    expect(screen.getByText("every 15 s")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Efficient/ }));
    await until(() => backend.called("update_settings"), { label: "profile persisted" });
    expect(lastSent(backend).resourceMode?.profile).toBe("efficient");
    // The effects view now states Efficient's relaxed cadence.
    expect(screen.getByText("every 45 s")).toBeInTheDocument();
  });

  it("arrow keys move and select within the radio group", async () => {
    const { screen, backend, user } = mountWithProviders(ResourceModeSection, {
      commands: baseCommands(),
    });
    const balanced = screen.getByRole("radio", { name: /Balanced/ });
    balanced.focus();
    await user.keyboard("{ArrowRight}");
    await until(() => backend.called("update_settings"), { label: "keyboard selection persisted" });
    expect(lastSent(backend).resourceMode?.profile).toBe("performance");
  });

  it("a numeric override persists clamped, is badged, and 'use preset' removes it", async () => {
    const { screen, backend, user } = mountWithProviders(ResourceModeSection, {
      commands: baseCommands(),
    });
    await user.click(screen.getByRole("button", { name: "Advanced overrides" }));
    const input = await screen.findByLabelText(/Git sweep interval/);
    await user.clear(input);
    await user.type(input, "2");
    (input as HTMLInputElement).dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => backend.called("update_settings"), { label: "override persisted" });
    // 2 s is below the hard floor -> clamped to 5 s (5000 ms), never stored raw.
    expect(lastSent(backend).resourceMode?.overrides?.gitSweepIntervalMs).toBe(5_000);
    // The effects view marks the capability as overridden…
    expect(screen.getByText("overridden")).toBeInTheDocument();
    // …and "use preset" removes the override entirely (no residue).
    await user.click(screen.getAllByRole("button", { name: "Use preset" })[0]);
    await until(
      () => lastSent(backend).resourceMode?.overrides?.gitSweepIntervalMs === undefined,
      { label: "override cleared" },
    );
    expect(lastSent(backend).resourceMode?.overrides).toEqual({});
  });

  it("reset clears every override at once", async () => {
    app.settings.resourceMode = {
      profile: "balanced",
      overrides: { orchestrationConcurrency: 2, petFlavour: false },
      autoSleep: false,
      schemaVersion: 1,
    };
    const { screen, backend, user } = mountWithProviders(ResourceModeSection, {
      commands: baseCommands(),
    });
    await user.click(screen.getByRole("button", { name: "Advanced overrides" }));
    await user.click(screen.getByRole("button", { name: /Reset all overrides/ }));
    await until(() => backend.called("update_settings"), { label: "reset persisted" });
    expect(lastSent(backend).resourceMode?.overrides).toEqual({});
    expect(lastSent(backend).resourceMode?.profile).toBe("balanced");
  });

  it("the auto-sleep feature flag persists and gates its level controls", async () => {
    const { screen, backend, user } = mountWithProviders(ResourceModeSection, {
      commands: baseCommands(),
    });
    await user.click(screen.getByRole("button", { name: "Advanced overrides" }));
    // Flag off: the idle-threshold override is disabled.
    expect(screen.getByLabelText(/Auto-sleep idle threshold/)).toBeDisabled();
    await user.click(screen.getByRole("switch", { name: /Workspace auto-sleep/ }));
    await until(() => backend.called("update_settings"), { label: "flag persisted" });
    expect(lastSent(backend).resourceMode?.autoSleep).toBe(true);
    expect(screen.getByLabelText(/Auto-sleep idle threshold/)).toBeEnabled();
  });

  it("a corrupt persisted document renders as Balanced with nothing overridden", () => {
    app.settings.resourceMode = {
      profile: "turbo",
      overrides: { nonsense: 12, gitSweepIntervalMs: "fast" },
      schemaVersion: 1,
    } as never;
    const { screen } = mountWithProviders(ResourceModeSection, { commands: baseCommands() });
    expect(screen.getByRole("radio", { name: /Balanced/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.queryByText("overridden")).not.toBeInTheDocument();
  });
});
