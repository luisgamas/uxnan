/**
 * The one run-options picker: the level a model runs at by default is shown
 * and marked, untouched sends nothing (the bridge runs that default), a pick is
 * kept, going back to the default forgets it, and a knob with no default offers
 * the model's own first.
 */

import { describe, expect, it } from "vitest";
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
  return screen.findAllByRole("menuitemradio", { hidden: true }, { timeout: 5000 });
}

/** What the picker would send: the host's bound values. */
function sent(view: { getByTestId: (id: string) => HTMLElement }): Record<string, unknown> {
  return JSON.parse(view.getByTestId("values").textContent ?? "{}");
}

/** Pick the row whose text starts with [label], from the keyboard. */
async function choose(user: Keys, rows: HTMLElement[], label: string) {
  const row = rows.find((r) => r.textContent?.trim().startsWith(label));
  if (!row) throw new Error(`no row ${label}`);
  row.focus();
  await user.keyboard("{Enter}");
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
    expect(sent(screen)).toEqual({ reasoning: "low" });
    expect(screen.getByRole("button", { name: "Reasoning effort: Low" })).toBeTruthy();
    await choose(user, await open(user, screen.getByRole("button", { name: /Reasoning effort/ })), "High");
    expect(sent(screen)).toEqual({});
  });

  it("offers the model's own default first when the agent names none", async () => {
    const { screen, user } = mountWithProviders(RunOptionsHost, { props: { options: [effort()] } });
    const rows = await open(user, screen.getByRole("button", { name: "Reasoning effort: Model default" }));
    expect(rows.map((r) => r.textContent?.trim())).toEqual(["Model default", "Low", "Medium", "High"]);
    await choose(user, rows, "High");
    expect(sent(screen)).toEqual({ reasoning: "high" });
    await choose(user, await open(user, screen.getByRole("button", { name: /Reasoning effort/ })), "Model default");
    expect(sent(screen)).toEqual({});
  });

  it("draws nothing for a model without knobs", () => {
    const { screen } = mountWithProviders(RunOptionsPicker, { props: { options: [], values: {} } });
    expect(screen.queryByRole("button")).toBeNull();
  });
});
