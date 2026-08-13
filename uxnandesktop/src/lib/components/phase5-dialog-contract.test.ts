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

  it("centralizes the draggable tab label width", () => {
    const terminal = source("TerminalArea.svelte");
    expect(terminal.match(/tab\.terminalLabel/g)?.length).toBe(3);
    expect(terminal).not.toContain('class="max-w-[120px]');
  });
});
