import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

describe("phase-five dialog density contracts", () => {
  it("keeps selection rows and destructive options on shared roles", () => {
    expect(source("AddProjectDialog.svelte")).toContain("row.choice");
    const remove = source("RemoveWorktreeDialog.svelte");
    expect(remove).toContain("panel.card");
    expect(remove).toContain("designRow.choice");
    expect(remove).toContain("designRow.editorDisclosure");
  });

  it("uses the button primitive for the launcher settings action", () => {
    const launcher = source("LauncherDialog.svelte");
    expect(launcher).toContain('<Button\n        variant="ghost"\n        size="sm"');
  });

  it("gives the confirmation dialog the one shared footer band", () => {
    const confirm = source("ConfirmDialog.svelte");
    // One action-footer role for every dialog: a confirmation is not a second
    // one. `Dialog.Footer` already carries `dialog.footer`.
    expect(confirm).toContain('<Dialog.Footer class="min-w-0">');
    expect(source("../design.ts")).not.toContain("confirmFooter");
    // Its header *is* the whole content, so it drops the 16px it reserves for a
    // following section (the content grid's gap already spaces it from the
    // footer) and the 32px inset for the close button this dialog never shows.
    expect(confirm).toContain('showCloseButton={false}');
    expect(confirm).toContain("pb-0 pr-0");
  });

  it("lets the action band be narrower than its own buttons", () => {
    // `dialog.content` is a grid with one `auto` track, so the track grows to
    // the widest item's min-content — and a row of actions is that item. Without
    // this, three Spanish labels (370px) pushed the 384px unsaved-changes dialog
    // to a 410px band, 26px of grey hanging past its rounded corner. Measured in
    // a browser against the built stylesheet, not reasoned about.
    expect(source("../design.ts")).toContain(
      'footer: "-mx-5 min-w-0 rounded-b-xl border-t bg-muted/50 px-5 py-3"',
    );
  });

  it("gives a three-answer prompt the width three answers need", () => {
    // Its actions measure 370px; `small` offers 344px of inset. The prompt that
    // asks whether to save, discard or cancel is the one dialog in the app with
    // three actions, so it is the one that cannot use the confirmation width.
    const saveDiscard = source("SaveDiscardDialog.svelte");
    expect(saveDiscard).toContain('<Dialog.Content size="medium">');
  });

  it("centralizes the draggable tab label width", () => {
    const terminal = source("TerminalArea.svelte");
    expect(terminal.match(/tab\.terminalLabel/g)?.length).toBe(3);
    expect(terminal).not.toContain('class="max-w-[120px]');
  });
});
