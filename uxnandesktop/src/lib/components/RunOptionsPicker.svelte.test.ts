/**
 * The one run-options picker: the level a model runs at by default is shown
 * and marked, untouched sends nothing (the bridge runs that default), a pick is
 * kept, going back to the default forgets it, and a knob with no default offers
 * the model's own first.
 */

import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/svelte";
import { mountWithProviders } from "../../test/render";
import type { AgentModelOption } from "$shared/agents/agent-capabilities";
import RunOptionsPicker from "./RunOptionsPicker.svelte";
import RunOptionsHost from "../../test/RunOptionsHost.svelte";

/** Open a pill's menu from the keyboard (↓ only opens; Enter toggles, and the
 *  synthetic click that follows it in jsdom would close it again). jsdom has no
 *  layout, so the floating menu stays `visibility: hidden`: its items are
 *  queried with `hidden: true`. */
type Keys = { keyboard: (k: string) => Promise<void> };

async function open(user: Keys, pill: HTMLElement): Promise<HTMLElement[]> {
  pill.focus();
  await user.keyboard("{ArrowDown}");
  const rows = await screen.findAllByRole("menuitemradio", { hidden: true }, { timeout: 5000 });
  // The menu focuses its first row once it has opened; wait for that, or it
  // lands after a row the test focused and Enter picks the wrong one.
  await vi.waitFor(() => expect(rows).toContain(document.activeElement), { timeout: 5000 });
  return rows;
}

/** What the picker would send: the host's bound values. */
function sent(view: { getByTestId: (id: string) => HTMLElement }): Record<string, unknown> {
  return JSON.parse(view.getByTestId("values").textContent ?? "{}");
}

/** Pick the row whose text starts with [label], from the keyboard, and wait
 *  for the menu to close (so the next `open` never finds the closing one's rows). */
async function choose(user: Keys, rows: HTMLElement[], label: string) {
  const row = rows.find((r) => r.textContent?.trim().startsWith(label));
  if (!row) throw new Error(`no row ${label}`);
  // On a slow runner the menu can move focus after it opened (to its first
  // row) once the test already focused this one: Enter would then pick that
  // row. Press it only once focus has stayed here for a moment.
  await vi.waitFor(
    async () => {
      row.focus();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(document.activeElement).toBe(row);
    },
    { timeout: 5000 },
  );
  await user.keyboard("{Enter}");
  await vi.waitFor(() => expect(screen.queryAllByRole("menuitemradio", { hidden: true })).toHaveLength(0), {
    timeout: 5000,
  });
}

/** Wait for what the picker would send to become [expected]. */
async function expectSent(view: { getByTestId: (id: string) => HTMLElement }, expected: Record<string, unknown>) {
  await vi.waitFor(() => expect(sent(view)).toEqual(expected), { timeout: 5000 });
}

const levels = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
const effort = (defaultValue?: string): AgentModelOption => ({
  key: "reasoning",
  kind: "enum",
  label: "Reasoning effort",
  values: levels,
  ...(defaultValue ? { default: defaultValue } : {}),
});

describe("RunOptionsPicker", () => {
  it("shows the level the model runs at by default, and marks it in the menu", async () => {
    const { screen, user } = mountWithProviders(RunOptionsHost, { props: { options: [effort("high")] } });
    const rows = await open(user, screen.getByRole("button", { name: "Reasoning effort: High" }));
    const high = rows.find((r) => r.textContent?.includes("High"))!;
    expect(high.getAttribute("aria-checked")).toBe("true");
    expect(high.textContent).toContain("Default");
    expect(rows.map((r) => r.textContent?.trim())).toEqual(["Low", "Medium", "High Default"]);
    expect(sent(screen)).toEqual({});
  });

  it("keeps a pick, and forgets it when the default is picked again", async () => {
    const { screen, user } = mountWithProviders(RunOptionsHost, { props: { options: [effort("high")] } });
    await choose(user, await open(user, screen.getByRole("button", { name: /Reasoning effort/ })), "Low");
    await expectSent(screen, { reasoning: "low" });
    expect(screen.getByRole("button", { name: "Reasoning effort: Low" })).toBeTruthy();
    await choose(user, await open(user, screen.getByRole("button", { name: /Reasoning effort/ })), "High");
    await expectSent(screen, {});
  });

  it("offers the model's own default first when the agent names none", async () => {
    const { screen, user } = mountWithProviders(RunOptionsHost, { props: { options: [effort()] } });
    const rows = await open(user, screen.getByRole("button", { name: "Reasoning effort: Default" }));
    expect(rows.map((r) => r.textContent?.trim())).toEqual(["Default", "Low", "Medium", "High"]);
    await choose(user, rows, "High");
    await expectSent(screen, { reasoning: "high" });
    await choose(user, await open(user, screen.getByRole("button", { name: /Reasoning effort/ })), "Default");
    await expectSent(screen, {});
  });

  it("draws nothing for a model without knobs", () => {
    const { screen } = mountWithProviders(RunOptionsPicker, { props: { options: [], values: {} } });
    expect(screen.queryByRole("button")).toBeNull();
  });
});
