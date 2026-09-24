/**
 * The shared confirmation dialog, and the two signals it has to keep apart.
 *
 * `oncancel` is the ghost button — an explicit answer, which for some callers
 * is a real action ("discard this draft and leave"), so Escape must not fire
 * it. `ondismiss` is "closed without confirming", by any route, and a caller
 * that drives `open` from its own state needs exactly that: without it, the
 * parent still believes the dialog is up, the next request to open it is not a
 * change, and a destructive action silently does nothing the second time —
 * which is how this was found.
 */

import { describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

import { mountWithProviders } from "../../test/render";
import ConfirmDialog from "./ConfirmDialog.svelte";

function open(props: Record<string, unknown> = {}) {
  return mountWithProviders(ConfirmDialog, {
    props: {
      open: true,
      title: "Delete this?",
      description: "It cannot be undone.",
      confirmLabel: "Delete",
      onconfirm: () => {},
      ...props,
    },
  });
}

describe("ConfirmDialog", () => {
  it("reports the ghost button as both an answer and a dismissal", async () => {
    const oncancel = vi.fn();
    const ondismiss = vi.fn();
    const onconfirm = vi.fn();
    const { screen, user } = open({ oncancel, ondismiss, onconfirm });

    await user.click(screen.getByText("Cancel"));
    await tick();
    expect(oncancel).toHaveBeenCalledTimes(1);
    expect(ondismiss).toHaveBeenCalledTimes(1);
    expect(onconfirm).not.toHaveBeenCalled();
  });

  it("reports Escape as a dismissal, and never as the ghost button", async () => {
    const oncancel = vi.fn();
    const ondismiss = vi.fn();
    const { user } = open({ oncancel, ondismiss });

    await user.keyboard("{Escape}");
    await tick();
    expect(ondismiss).toHaveBeenCalledTimes(1);
    // The caller whose ghost button *does* something — "discard and leave" —
    // must not have it done to them by pressing Escape.
    expect(oncancel).not.toHaveBeenCalled();
  });

  it("says nothing on a confirm that went through", async () => {
    const oncancel = vi.fn();
    const ondismiss = vi.fn();
    const { screen, user } = open({ oncancel, ondismiss, onconfirm: () => {} });

    await user.click(screen.getByText("Delete"));
    await tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(oncancel).not.toHaveBeenCalled();
    expect(ondismiss).not.toHaveBeenCalled();
  });

  it("stays open, and still reports nothing, when the action refuses", async () => {
    const ondismiss = vi.fn();
    const { screen, user } = open({ ondismiss, onconfirm: () => false, error: "it failed" });

    await user.click(screen.getByText("Delete"));
    await tick();
    expect(screen.queryByRole("dialog")).not.toBeNull();
    expect(ondismiss).not.toHaveBeenCalled();
  });

  it("names its ghost button when the caller gives it a name, and can refuse the confirm", () => {
    const { screen } = open({
      cancelLabel: "Discard and leave",
      confirmDisabled: true,
      confirmLabel: "Save",
    });
    expect(screen.getByText("Discard and leave")).toBeTruthy();
    expect(screen.queryByText("Cancel")).toBeNull();
    const save = screen.getByText("Save").closest("button");
    expect(save?.hasAttribute("disabled")).toBe(true);
  });
});
