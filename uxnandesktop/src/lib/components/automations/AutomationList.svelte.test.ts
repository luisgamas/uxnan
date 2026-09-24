/**
 * The automations list, and the one action that can lose work: delete.
 *
 * Reported from a real session: after cancelling the delete dialog, asking to
 * delete again did nothing — the confirmation never came back, and a second
 * press of a destructive action that silently does nothing is the worst of both
 * outcomes. The cause was the dialog's `open` handed down one way: the dialog
 * closes itself, the parent's state still says "open", so the next request is
 * not a change and nothing happens.
 */

import { describe, expect, it } from "vitest";
import { tick } from "svelte";

import { mountWithProviders } from "../../../test/render";
import { automations } from "$lib/state/automations.svelte";
import { newAutomation, type Automation } from "$lib/automations/types";
import AutomationList from "./AutomationList.svelte";

const commands = {
  automations_list: () => [] as Automation[],
  automations_scheduler_supported: () => true,
  automations_scheduler_status: () => ({ kind: "registered" }),
  automations_runs: () => [],
  automations_delete: () => undefined,
  ai_commit_agents: () => ["claude"],
};

function listOf(...names: string[]) {
  automations.items = names.map((name, i) => {
    const a = newAutomation(`a-${i}`, name, "/code/app");
    a.steps = [
      {
        id: "s1",
        title: "Step",
        agent: "claude",
        model: "",
        prompt: "do it",
        dependsOn: [],
        onFailure: "stop",
        maxAttempts: 1,
        autonomous: false,
      },
    ];
    return a;
  });
  automations.loading = false;
  automations.clearProposal();
}

/** Let bits-ui finish closing a layer: it releases the body's pointer lock a
 *  couple of frames after the close, and a person's next click is never that
 *  fast. */
async function settle() {
  await new Promise((r) => setTimeout(r, 50));
  await tick();
}

/** Open the row's ⋯ menu and press one of its items. */
async function menu(screen: { getAllByLabelText: (l: string) => HTMLElement[]; findByText: (t: string) => Promise<HTMLElement> }, user: { click: (el: Element) => Promise<void> }, item: string) {
  await user.click(screen.getAllByLabelText("More")[0]);
  await tick();
  await user.click(await screen.findByText(item));
  // The dialog opens one macrotask later, on purpose (`deferModalOpen`): a
  // bits-ui modal opened inside a closing menu inherits its pointer lock.
  await new Promise((r) => setTimeout(r, 0));
  await tick();
}

describe("AutomationList", () => {
  it("paints delete as what it is", async () => {
    listOf("Nightly lint");
    const { screen, user } = mountWithProviders(AutomationList, { commands });
    await user.click(screen.getAllByLabelText("More")[0]);
    await tick();
    // The app marks a destructive menu item, and the theme colours it from
    // there (`data-[variant=destructive]:text-destructive`). Delete drops the
    // automation, its OS task and its whole history: it reads as red or it is
    // the one item that looks like the others.
    const remove = (await screen.findByText("Delete")).closest("[data-variant]");
    expect(remove?.getAttribute("data-variant")).toBe("destructive");
  });

  it("asks again every time delete is pressed, not only the first time", async () => {
    listOf("Nightly lint");
    const { screen, user } = mountWithProviders(AutomationList, { commands });

    await menu(screen, user, "Delete");
    expect((await screen.findByRole("dialog")).textContent).toMatch(/Nightly lint/);

    // Cancel, and ask again: the confirmation has to come back.
    await user.click(screen.getByText("Cancel"));
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    // The body's pointer lock belongs to the layer that is open; once nothing
    // is, it is gone and clicks land again (`utils/pointerLock`).
    expect(document.body.style.pointerEvents).toBe("");

    await menu(screen, user, "Delete");
    expect(screen.queryByRole("dialog")).not.toBeNull();
    expect(automations.items).toHaveLength(1);
  });

  it("deletes only when the dialog is confirmed", async () => {
    listOf("Nightly lint");
    const { screen, user, backend } = mountWithProviders(AutomationList, { commands });

    await menu(screen, user, "Delete");
    await user.click(screen.getAllByText("Delete").at(-1)!);
    await tick();
    expect(backend.called("automations_delete")).toBe(true);
  });
});
