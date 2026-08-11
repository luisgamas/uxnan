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

  it("centralizes the draggable tab label width", () => {
    const terminal = source("TerminalArea.svelte");
    expect(terminal.match(/tab\.terminalLabel/g)?.length).toBe(3);
    expect(terminal).not.toContain('class="max-w-[120px]');
  });
});
