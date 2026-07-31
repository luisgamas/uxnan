/**
 * The first test that asserts *behaviour* rather than markup.
 *
 * `SaveDiscardDialog` is the one place the app asks "you have unsaved edits —
 * save, discard, or stay?", and the answer travels back through a promise that
 * non-component code (the tab-close path) is awaiting. So the thing worth
 * testing is not what the dialog looks like; it is that every way out of it
 * resolves that promise, with the right answer, exactly once.
 *
 * The failure this guards against is specific and nasty: a route out of the
 * dialog that resolves nothing leaves the caller awaiting forever, and the tab
 * simply never closes — with no error anywhere.
 */

import { describe, expect, it } from "vitest";

import { mount } from "../../test/render";
import { saveDiscard, type SaveChoice } from "$lib/state/confirm.svelte";
import SaveDiscardDialog from "./SaveDiscardDialog.svelte";

/** Open the dialog the way the app does, and keep hold of the pending answer. */
function ask() {
  return saveDiscard.request({
    title: "Unsaved changes in notes.md",
    description: "Save before closing?",
    saveLabel: "Save",
    discardLabel: "Discard",
  });
}

/** Resolve-or-timeout, so a promise that never settles fails as a timeout with a
 *  readable message instead of hanging the suite. */
async function answered(promise: Promise<SaveChoice>): Promise<SaveChoice> {
  return await Promise.race([
    promise,
    new Promise<SaveChoice>((_, reject) =>
      setTimeout(() => reject(new Error("the dialog never resolved its promise")), 2000),
    ),
  ]);
}

describe("SaveDiscardDialog", () => {
  it("stays closed until something asks", () => {
    const { screen } = mount(SaveDiscardDialog);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the caller's title, description and button labels", async () => {
    const { screen } = mount(SaveDiscardDialog);
    const pending = ask();

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes in notes.md")).toBeInTheDocument();
    expect(screen.getByText("Save before closing?")).toBeInTheDocument();
    // The labels are the caller's words, not hard-coded in the component.
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();

    saveDiscard.choose("cancel");
    await pending;
  });

  it.each([
    ["Save", "save"],
    ["Discard", "discard"],
  ] as const)("resolves with %s when that button is pressed", async (label, choice) => {
    const { screen, user } = mount(SaveDiscardDialog);
    const pending = ask();
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: label }));

    expect(await answered(pending)).toBe(choice);
  });

  it("treats dismissing the dialog as cancel, not as a silent no-op", async () => {
    // Escape is the route a caller can't see. If it resolved nothing, the tab
    // close it belongs to would hang forever with no error.
    const { screen, user } = mount(SaveDiscardDialog);
    const pending = ask();
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");

    expect(await answered(pending)).toBe("cancel");
  });

  it("closes after a choice, so the next request starts from a clean dialog", async () => {
    const { screen, user } = mount(SaveDiscardDialog);
    const first = ask();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Discard" }));
    await answered(first);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const second = saveDiscard.request({
      title: "A different file",
      saveLabel: "Keep",
      discardLabel: "Throw away",
    });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("A different file")).toBeInTheDocument();
    // The previous description must not survive into the new prompt.
    expect(screen.queryByText("Save before closing?")).not.toBeInTheDocument();

    saveDiscard.choose("cancel");
    await second;
  });

  it("cancels an outstanding request if a second one arrives", async () => {
    // Defensive path in the service: the UI is modal so it should not happen,
    // but if it does, the first caller must not be left awaiting.
    mount(SaveDiscardDialog);
    const first = ask();
    const second = ask();

    expect(await answered(first)).toBe("cancel");

    saveDiscard.choose("save");
    expect(await answered(second)).toBe("save");
  });
});
