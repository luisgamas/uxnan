/**
 * The editor, in the one state an agent can put it in: opened on a draft that
 * an agent proposed through the control surface (`automation/propose`).
 *
 * What matters is that the person is told. A form that filled itself in with
 * somebody else's idea and said nothing about it is the failure mode this
 * feature has to avoid — so the notice names who drafted it, says nothing was
 * created or scheduled, and the way out is *Discard*, not *Back*. And because
 * the draft was never stored, that way out asks first: the answer it offers
 * first is saving.
 */

import { describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

import { mountWithProviders } from "../../../test/render";
import { buildProposal } from "$lib/automations/proposal";
import { newAutomation } from "$lib/automations/types";
import AutomationEditor from "./AutomationEditor.svelte";

const commands = { ai_commit_agents: () => ["claude", "codex"] };

function draft() {
  return buildProposal(
    {
      name: "Nightly lint",
      workingDir: "/code/app",
      steps: [{ agent: "claude", prompt: "Run the linter." }],
    },
    ["claude", "codex"],
    () => "draft-1",
  );
}

describe("AutomationEditor", () => {
  it("says who proposed the draft, and that nothing exists yet", async () => {
    const { screen } = mountWithProviders(AutomationEditor, {
      props: { automation: draft(), onback: () => {}, proposedBy: "Claude Code" },
      commands,
    });

    const notice = await screen.findByTestId("automation-proposal");
    expect(notice.textContent).toContain("Claude Code");
    expect(notice.textContent).toMatch(/Nothing has been created or scheduled/i);
    expect(notice.textContent).toMatch(/paused/i);
    // The way out of somebody else's draft is discarding it, not "back".
    expect(screen.getByText("Discard")).toBeTruthy();
  });

  it("still says so when a shell proposed it and there is no agent to name", async () => {
    const { screen } = mountWithProviders(AutomationEditor, {
      props: { automation: draft(), onback: () => {}, proposedBy: null },
      commands,
    });
    const notice = await screen.findByTestId("automation-proposal");
    // Not "an agent": a shell proposed it, and saying otherwise would be a
    // small lie in the one place the person is deciding whom to trust.
    expect(notice.textContent).toMatch(/came from the control API/i);
  });

  it("asks before throwing the draft away, and offers saving first", async () => {
    const onback = vi.fn();
    const { screen, user } = mountWithProviders(AutomationEditor, {
      props: { automation: draft(), onback, proposedBy: "Claude Code" },
      commands,
    });

    await user.click(screen.getByText("Discard"));
    await tick();

    // The dialog says what is lost, and the primary answer is Save.
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/Leave without saving this draft\?/i);
    expect(dialog.textContent).toMatch(/thrown away/i);
    expect(dialog.textContent).toMatch(/paused/i);
    // Nothing has happened yet: the editor is still there.
    expect(onback).not.toHaveBeenCalled();

    // The other answer leaves, and only then.
    await user.click(screen.getByText("Discard and leave"));
    expect(onback).toHaveBeenCalledTimes(1);
  });

  it("cannot offer to save a draft that is not saveable, and says why", async () => {
    const broken = draft();
    broken.workingDir = "";
    const { screen, user } = mountWithProviders(AutomationEditor, {
      props: { automation: broken, onback: () => {}, proposedBy: null },
      commands,
    });

    await user.click(screen.getByText("Discard"));
    await tick();
    const dialog = await screen.findByRole("dialog");
    const save = [...dialog.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Save"),
    );
    expect(save?.hasAttribute("disabled")).toBe(true);
    // The reason is in the dialog, not behind it.
    expect(dialog.textContent).toMatch(/folder/i);
  });

  it("shows no notice when the person is editing their own automation", () => {
    const { screen } = mountWithProviders(AutomationEditor, {
      props: { automation: newAutomation("a-1", "Mine", "/code/app"), onback: () => {} },
      commands,
    });
    expect(screen.queryByTestId("automation-proposal")).toBeNull();
    expect(screen.getByText("Back")).toBeTruthy();
  });

  it("leaves a person's own edit without asking", async () => {
    const onback = vi.fn();
    const { screen, user } = mountWithProviders(AutomationEditor, {
      props: { automation: newAutomation("a-1", "Mine", "/code/app"), onback },
      commands,
    });
    await user.click(screen.getByText("Back"));
    expect(onback).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
