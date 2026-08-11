import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (name: string) =>
  readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

describe("phase-five work-surface contracts", () => {
  it("keeps tree, changes, and history rows on shared density roles", () => {
    const files = [
      "FileTreePanel.svelte",
      "FileTreeRow.svelte",
      "ChangesPanel.svelte",
      "HistoryPanel.svelte",
    ];

    for (const name of files) {
      expect(source(name), name).toContain("row.list");
    }

    expect(source("TreeInlineInput.svelte")).toContain("<Input");
    expect(source("TreeInlineInput.svelte")).toContain('density="compact"');
    expect(source("RightPanel.svelte")).toContain("min-w-0");
  });

  it("keeps GitHub and automation rows on shared density roles", () => {
    expect(source("GithubPanel.svelte")).toContain("row.list");
    expect(source("GitHub.svelte")).toContain("row.list");
    expect(source("Automations.svelte")).toContain("row.settingsNav");
    expect(source("automations/AutomationList.svelte")).toContain("row.list");
    expect(source("automations/AutomationsOverview.svelte")).toContain("row.list");
    expect(source("automations/RunView.svelte")).toContain("row.list");
    expect(source("orchestration/OrchestrationBroadcast.svelte")).toContain("row.list");
  });

  it("does not reintroduce undersized interactive overrides", () => {
    const files = [
      "GithubPanel.svelte",
      "GitHub.svelte",
      "CreatePrForm.svelte",
      "Automations.svelte",
      "automations/AutomationEditor.svelte",
      "automations/AutomationList.svelte",
      "automations/AutomationRuns.svelte",
      "automations/AutomationsOverview.svelte",
      "automations/RunView.svelte",
      "automations/SchedulePicker.svelte",
      "automations/StepGraphEditor.svelte",
      "automations/StepVariablePicker.svelte",
      "orchestration/OrchestrationBroadcast.svelte",
      "orchestration/StepContextPicker.svelte",
      "orchestration/StepEditor.svelte",
    ];

    for (const name of files) {
      const content = source(name);
      expect(content, name).not.toMatch(/class=[^>]*\bh-[67]\b/);
      expect(content, name).not.toMatch(/triggerClass="w-/);
    }
  });

  it("exposes expanded state for custom work-surface disclosures", () => {
    expect(source("GitHub.svelte")).toContain("aria-expanded={ciOpen}");
    expect(source("GitHub.svelte")).toContain("aria-expanded={Boolean(expandedFiles");
    expect(source("automations/StepVariablePicker.svelte")).toContain("aria-expanded={isOpen}");
    expect(source("automations/StepVariablePicker.svelte")).toContain("aria-expanded={runOpen}");
    expect(source("orchestration/StepContextPicker.svelte")).toContain("aria-expanded={isOpen}");
    expect(source("orchestration/StepEditor.svelte")).toContain("aria-expanded={advancedOpen}");
  });

  it("keeps localized time controls and project hover actions on their shared roles", () => {
    const schedule = source("automations/SchedulePicker.svelte");
    expect(schedule).toContain('<Input\n        type="time"');
    expect(schedule).toContain("class={field.time}");

    const project = source("ProjectCard.svelte");
    expect(project).toContain("group-hover/header:opacity-100");
    expect(project).toContain("row.projectHeader");
  });
});
