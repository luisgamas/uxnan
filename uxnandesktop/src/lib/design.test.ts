import { describe, expect, it } from "vitest";

import { control, dialog, field, iconButton, overlay, row, shell, surface, tab } from "$lib/design";

describe("desktop density tokens", () => {
	it("keeps interactive roles at or above the 28px floor", () => {
		expect(control.standard).toContain("h-9");
		expect(control.compact).toContain("h-8");
		expect(control.dense).toContain("h-7");
		expect(iconButton.xs).toContain("size-7");
		expect(iconButton.sm).toContain("size-8");
		expect(iconButton.action).toContain("size-8");
	});

	it("uses viewport-clamped overlay widths and composable dialog spacing", () => {
		expect(overlay.item).toContain("min-h-9");
		expect(overlay.item).toContain("px-2");
		expect(overlay.infoWidth).toContain("max-w-[calc(100vw-1rem)]");
		expect(overlay.formWidth).toContain("w-80");
		expect(overlay.commandWidth).toContain("max-w-[calc(100vw-1rem)]");
		expect(overlay.statusWidth).toContain("w-96");
		expect(overlay.menuSimple).toContain("min-w-44");
		expect(overlay.menuStandard).toContain("min-w-52");
		expect(overlay.menuWide).toContain("min-w-56");
		expect(dialog.content).toContain("px-5");
		expect(dialog.footer).not.toContain("-mx");
		expect(iconButton.sm).toBe("size-8");
	});

	it("exposes named shell and row roles for phase-three chrome", () => {
		expect(shell.statusBar).toContain("h-7");
		expect(shell.terminalStrip).toContain("h-9");
		expect(shell.rightPanelTabs).toContain("h-8");
		expect(shell.laneHeader).toContain("min-h-7");
		expect(shell.laneAction).toContain("min-h-7");
		expect(shell.titlebarControl).toContain("h-9");
		expect(row.agent).toContain("min-h-8");
		expect(row.agent).toContain("relative");
		expect(row.agentActiveIndicator).toContain("h-4");
		expect(row.agentActiveIndicator).toContain("bg-foreground");
		expect(row.agentActiveIndicator).toContain("-left-1");
		expect(row.agentLeading).toContain("self-center");
		expect(row.projectHeader).toContain("min-h-9");
		expect(row.searchResult).toContain("h-[52px]");
		expect(row.agentModel).toContain("max-w-28");
		expect(row.agentDetail).toContain("ml-[1.375rem]");
		expect(row.agentSpaceHeader).toContain("min-w-0");
		expect(row.agentAvatarStrip).toContain("flex-nowrap");
		expect(row.agentAvatarStrip).toContain("gap-0");
		expect(row.agentAvatarStrip).toContain("overflow-hidden");
		expect(row.agentOverflow).toContain("size-7");
		expect(row.agentSpaceDetail).toContain("pl-1.5");
		expect(surface.active).not.toContain("ring-");
		expect(row.projectSummary).toContain("pl-8");
		expect(overlay.paletteViewport).toContain("max-h-[22rem]");
		expect(shell.sidebarBrand).toContain("h-9");
		expect(shell.sidebarSectionHeader).toContain("h-8");
		expect(tab.panelTrigger).toContain("px-3");
		expect(tab.terminalTrigger).toContain("text-[13px]");
		expect(field.search).toContain("items-center");
		expect(field.searchIcon).toContain("shrink-0");
		expect(field.searchLabel).toContain("flex-1");
		expect(field.searchShortcut).toContain("shrink-0");
	});
});
