/**
 * Settings → Resources, and above all its export flow: the dialog must list
 * the document's fields BEFORE anything touches disk, cancelling must write
 * nothing, and confirming must write exactly the document that was shown —
 * consent-first is the feature's whole privacy story, so it gets the tests.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { mount, until } from "../../test/render";
import { app } from "$lib/state/app.svelte";
import type { ResourceExport } from "$lib/types";
import ResourceSettings from "./ResourceSettings.svelte";

beforeEach(() => {
  // A bits-ui modal that is still open when its test unmounts leaves
  // `pointer-events: none` on the body, blocking every later click in the
  // file (the same leak the app guards against at runtime). Reset it.
  document.body.style.pointerEvents = "";
});

function exportDoc(): ResourceExport {
  return {
    schemaVersion: 1,
    exportedAtMs: 1_750_000_000_000,
    platform: "windows",
    appVersion: "0.0.24",
    capabilities: {
      cpu: true,
      memory: true,
      virtualMemory: true,
      io: true,
      startTime: true,
      validated: true,
    },
    sampling: { active: false, reason: "off" },
    bufferSeconds: 600,
    fields: ["schemaVersion", "cpuPercent / cpuAvgPercent / cpuPeakPercent", "pids (orphans only)"],
    groups: [],
    orphans: [],
  };
}

/** Handlers every mount here needs; tests add their own on top. */
function baseCommands() {
  return {
    update_settings: () => ({ version: 1, repos: [], settings: {}, agentCache: [] }),
    resources_export: () => exportDoc(),
  };
}

describe("ResourceSettings", () => {
  it("renders the switches from the current settings", () => {
    app.settings.resources = { enabled: true, orphanSweep: false, orphanSweepSeconds: 20 };
    const { screen } = mount(ResourceSettings, { commands: baseCommands() });
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(2);
    expect(switches[0]).toBeChecked(); // resource monitor on
    expect(switches[1]).not.toBeChecked(); // orphan sweep off (opt-in)
  });

  it("persists a toggle through the real settings command", async () => {
    app.settings.resources = { enabled: true, orphanSweep: false, orphanSweepSeconds: 20 };
    const { screen, backend, user } = mount(ResourceSettings, { commands: baseCommands() });
    await user.click(screen.getAllByRole("switch")[1]);
    await until(() => backend.called("update_settings"), { label: "settings persisted" });
    const sent = backend.lastCallTo("update_settings")?.args.settings as {
      resources?: { orphanSweep?: boolean };
    };
    expect(sent.resources?.orphanSweep).toBe(true);
  });

  it("explains the three confidence levels", () => {
    app.settings.resources = { enabled: true };
    const { screen } = mount(ResourceSettings, { commands: baseCommands() });
    expect(screen.getByText("Exact")).toBeInTheDocument();
    expect(screen.getByText(/Inferred/)).toBeInTheDocument();
    expect(screen.getByText(/Unknown/)).toBeInTheDocument();
  });

  it("shows the export field list for consent before anything is written", async () => {
    app.settings.resources = { enabled: true };
    const { screen, backend, user } = mount(ResourceSettings, { commands: baseCommands() });
    await user.click(screen.getByRole("button", { name: /Export…/ }));
    // The dialog lists exactly the document's fields…
    const list = await until(
      () => document.querySelector('[data-testid="export-fields"]') !== null,
      { label: "consent dialog" },
    ).then(() => document.querySelector('[data-testid="export-fields"]')!);
    expect(list.textContent).toContain("pids (orphans only)");
    // …and nothing has touched disk yet.
    expect(backend.called("fs_write_file")).toBe(false);
    expect(backend.called("plugin:dialog|save")).toBe(false);
  });

  it("cancelling the consent dialog writes nothing", async () => {
    app.settings.resources = { enabled: true };
    const { screen, backend, user } = mount(ResourceSettings, { commands: baseCommands() });
    await user.click(screen.getByRole("button", { name: /Export…/ }));
    await until(() => document.querySelector('[data-testid="export-fields"]') !== null, {
      label: "consent dialog",
    });
    const cancel = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Cancel",
    );
    expect(cancel).toBeDefined();
    await user.click(cancel!);
    expect(backend.called("fs_write_file")).toBe(false);
  });

  it("confirming writes exactly the document that was shown", async () => {
    app.settings.resources = { enabled: true };
    const { screen, backend, user } = mount(ResourceSettings, {
      commands: {
        ...baseCommands(),
        "plugin:dialog|save": () => "C:\\tmp\\uxnan-resources.json",
        fs_write_file: () => undefined,
      },
    });
    await user.click(screen.getByRole("button", { name: /Export…/ }));
    await until(() => document.querySelector('[data-testid="export-fields"]') !== null, {
      label: "consent dialog",
    });
    const confirm = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Save file…",
    );
    await user.click(confirm!);
    await until(() => backend.called("fs_write_file"), { label: "file written" });
    const written = backend.lastCallTo("fs_write_file")?.args as { path: string; content: string };
    expect(written.path).toContain("uxnan-resources");
    expect(JSON.parse(written.content)).toEqual(exportDoc());
  });

  it("disables the sweep interval until the sweep itself is on", () => {
    app.settings.resources = { enabled: true, orphanSweep: false };
    const { screen } = mount(ResourceSettings, { commands: baseCommands() });
    expect(screen.getByLabelText(/Check interval/)).toBeDisabled();
  });
});
