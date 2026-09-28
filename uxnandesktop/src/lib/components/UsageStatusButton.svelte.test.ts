import { beforeEach, describe, expect, it } from "vitest";

import { mountWithProviders, until } from "../../test/render";
import { app } from "$lib/state/app.svelte";
import { usage } from "$lib/state/usage.svelte";
import { DEFAULT_SETTINGS } from "$lib/types";
import UsageStatusButton from "./UsageStatusButton.svelte";

/** The popover renders into a portal that role queries do not reach in jsdom —
 *  the same access the other status-popover tests use. */
function popoverText(): string {
  return document.querySelector('[data-slot="popover-content"]')?.textContent ?? "";
}

beforeEach(() => {
  if (!globalThis.PointerEvent) {
    class TestPointerEvent extends MouseEvent {
      readonly pointerType = "mouse";
      readonly isPrimary = true;
    }
    globalThis.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
  }
  usage.stop();
  usage.loading = false;
  // A Codex config saved by the old native reader, whose window ids the bridge
  // no longer reports: a real account now answers with one monthly window.
  app.settings = {
    ...DEFAULT_SETTINGS,
    usageProviders: [
      {
        provider: "codex",
        refreshMinutes: null,
        statusBar: { show: true, windows: ["primary_window", "secondary_window"] },
      },
    ],
  };
  usage.byProvider = {
    codex: {
      provider: "codex",
      status: "ok",
      windows: [{ id: "monthly", label: "Monthly", usedPercent: 95, windowMinutes: 43_200 }],
      updatedAt: Date.now(),
    },
  };
});

describe("UsageStatusButton", () => {
  it("shows the provider's first window when its saved picks are stale", async () => {
    const { screen, user } = mountWithProviders(UsageStatusButton);
    await user.click(screen.getByRole("button", { name: "AI provider usage" }));
    await until(() => popoverText().includes("Monthly"), { label: "the fallback window" });
    expect(popoverText()).not.toContain("No data");
  });

  it("counts the fallback window toward the icon's tint", () => {
    const { screen } = mountWithProviders(UsageStatusButton);
    const trigger = screen.getByRole("button", { name: "AI provider usage" });
    expect(trigger.querySelector("svg")?.getAttribute("class")).toContain("text-destructive");
  });
});
