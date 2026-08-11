import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { mountWithProviders, until } from "../../test/render";
import { app } from "$lib/state/app.svelte";
import { github } from "$lib/state/github.svelte";
import { resources } from "$lib/state/resources.svelte";
import { usage } from "$lib/state/usage.svelte";
import { DEFAULT_SETTINGS } from "$lib/types";
import BackendStatus from "./BackendStatus.svelte";
import UsageStatusButton from "./UsageStatusButton.svelte";
import {
  shouldPreventStatusPopoverAutoFocus,
  type StatusPopoverCloseReason,
} from "./status-popover-focus";

function popoverButton(label: RegExp): HTMLElement | null {
  return Array.from(document.querySelectorAll('[data-slot="popover-content"] button')).find((button) =>
    label.test(button.textContent ?? ""),
  ) as HTMLElement | undefined ?? null;
}

beforeEach(() => {
	if (!globalThis.PointerEvent) {
		class TestPointerEvent extends MouseEvent {
			readonly pointerType = "mouse";
			readonly isPrimary = true;
		}
		globalThis.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
	}
  app.settings = { ...DEFAULT_SETTINGS, resources: { ...DEFAULT_SETTINGS.resources, enabled: false } };
  app.backend = "ready";
  app.errorMessage = null;
  app.repos = [];
  app.settingsOpen = false;
  github.status = null;
  usage.stop();
  usage.byProvider = {};
  usage.loading = false;
});

afterEach(() => {
	for (const target of document.querySelectorAll("[data-test-xterm-target]")) target.remove();
});

function xtermTarget(): HTMLTextAreaElement {
	const target = document.createElement("textarea");
	target.setAttribute("aria-label", "terminal input");
	target.setAttribute("data-test-xterm-target", "true");
	document.body.append(target);
	return target;
}

describe("status popover close-focus policy", () => {
  it.each([
    ["outside", true],
    ["navigation", true],
    ["programmatic", true],
    ["escape", false],
  ] as const)("%s closes with preventAutoFocus=%s", (reason: StatusPopoverCloseReason, expected) => {
    expect(shouldPreventStatusPopoverAutoFocus(reason)).toBe(expected);
  });
});

describe("BackendStatus focus lifecycle", () => {
	it("transfers one outside pointer click into an xterm-like target", async () => {
		app.settings = { ...app.settings, resources: { ...app.settings.resources, enabled: true } };
		const { screen, user } = mountWithProviders(BackendStatus);
		const trigger = screen.getByRole("button", { name: /backend connected/i });
		const target = xtermTarget();
		await user.click(trigger);
		await until(() => document.querySelector('[data-slot="popover-content"]') !== null, {
			label: "backend popover open for outside pointer transfer",
		});

		await user.pointer({ target, keys: "[MouseLeft]" });
		await until(() => document.querySelector('[data-slot="popover-content"]') === null, {
			label: "backend popover closes after outside pointer transfer",
		});

		expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
		expect(target).toHaveFocus();
		expect(document.activeElement).toBe(target);
	});

	it("dismisses the trigger tooltip when opening the overlay", async () => {
		const { screen, user } = mountWithProviders(BackendStatus);
		const trigger = screen.getByRole("button", { name: /backend connected/i });
		await user.tab();
		await until(() => document.querySelector('[data-tooltip-content][data-state="delayed-open"], [data-tooltip-content][data-state="instant-open"]') !== null, {
			label: "backend trigger tooltip open",
		});

		await user.click(trigger);

		expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull();
		expect(document.querySelector('[data-tooltip-content][data-state="instant-open"]')).toBeNull();
	});

  it("restores the trigger when Escape closes from an inner control", async () => {
    app.settings = { ...app.settings, resources: { ...app.settings.resources, enabled: true } };
    const { screen, user } = mountWithProviders(BackendStatus);
    const trigger = screen.getByRole("button", { name: /backend connected/i });
    await user.click(trigger);
    await until(() => document.querySelector('[data-slot="popover-content"]') !== null, {
      label: "backend popover open",
    });
    const innerControl = document.querySelector('[data-slot="popover-content"] button') as HTMLButtonElement | null;
    expect(innerControl).not.toBeNull();
    innerControl?.focus();

    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });

  it("keeps focus from restoring to the trigger when navigating to resource settings", async () => {
    app.settings = { ...app.settings, resources: { ...app.settings.resources, enabled: true } };
    const { screen, user } = mountWithProviders(BackendStatus);
    const trigger = screen.getByRole("button", { name: /backend connected/i });
    await user.click(trigger);
    await until(() => popoverButton(/resource settings/i) !== null, {
      label: "resource settings action",
    });

    await user.click(popoverButton(/resource settings/i) as HTMLElement);
    expect(trigger).not.toHaveFocus();
    expect(app.settingsOpen).toBe(true);
    expect(app.settingsSection).toBe("resources");
  });
});

describe("UsageStatusButton focus lifecycle", () => {
	beforeEach(() => {
    app.settings.usageProviders = [
      { provider: "codex", statusBar: { show: true, windows: ["*"] } },
    ];
	});

	it("transfers one outside pointer click into an xterm-like target", async () => {
		const { screen, user } = mountWithProviders(UsageStatusButton, {
			commands: { usage_read: () => [] },
		});
		const trigger = screen.getByRole("button", { name: /ai provider usage/i });
		const target = xtermTarget();
		await user.click(trigger);
		await until(() => document.querySelector('[data-slot="popover-content"]') !== null, {
			label: "usage popover open for outside pointer transfer",
		});

		await user.pointer({ target, keys: "[MouseLeft]" });
		await until(() => document.querySelector('[data-slot="popover-content"]') === null, {
			label: "usage popover closes after outside pointer transfer",
		});

		expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
		expect(target).toHaveFocus();
		expect(document.activeElement).toBe(target);
	});

  it("restores the trigger when Escape closes from an inner control", async () => {
    const { screen, user } = mountWithProviders(UsageStatusButton, {
      commands: { usage_read: () => [] },
    });
    const trigger = screen.getByRole("button", { name: /ai provider usage/i });
    await user.click(trigger);
    await until(() => document.querySelector('[aria-label="Refresh now"]') !== null, {
      label: "usage refresh action",
    });
    (document.querySelector('[aria-label="Refresh now"]') as HTMLElement).focus();

    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });

  it("keeps focus from restoring to the trigger when navigating to providers", async () => {
    const { screen, user } = mountWithProviders(UsageStatusButton, {
      commands: { usage_read: () => [] },
    });
    const trigger = screen.getByRole("button", { name: /ai provider usage/i });
    await user.click(trigger);
    await until(() => popoverButton(/manage providers/i) !== null, {
      label: "manage providers action",
    });

    await user.click(popoverButton(/manage providers/i) as HTMLElement);
    expect(trigger).not.toHaveFocus();
    expect(app.settingsOpen).toBe(true);
    expect(app.settingsSection).toBe("providers");
  });
});
