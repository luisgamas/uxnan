import { describe, expect, it } from "vitest";

import { control, dialog, field, icon, iconButton, overlay, panel, row, shell, surface, tab } from "$lib/design";

describe("desktop density tokens", () => {
	it("keeps interactive roles at or above the 28px floor", () => {
		expect(control.standard).toContain("h-9");
		expect(control.compact).toContain("h-8");
		expect(control.dense).toContain("h-7");
		expect(iconButton.xs).toContain("size-7");
		expect(iconButton.tabClose).toContain("size-6");
		expect(iconButton.sm).toContain("size-8");
		expect(iconButton.action).toContain("size-8");
		expect(control.entityPicker).toContain("size-12");
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
		expect(dialog.footer).toContain("-mx-5");
		expect(dialog.footer).toContain("px-5");
		expect(dialog.footerSurface).toContain("min-h-14");
		expect(dialog.footerSurface).toContain("px-5");
		expect(dialog.paletteWidth).toContain("600px");
		expect(iconButton.sm).toBe("size-8");
	});

	it("exposes named shell and row roles for phase-three chrome", () => {
		expect(shell.statusBar).toContain("h-7");
		expect(shell.appBar).toContain("h-10");
		expect(shell.appBar).toContain("after:bottom-0");
		expect(shell.appBar).toContain("after:z-10");
		expect(shell.appBarOverlay).toBe("h-10");
		expect(shell.appBarAction).toContain("size-10");
		expect(shell.appBarCompactAction).toContain("size-10");
		expect(shell.rightPanelTabs).toContain("h-8");
		expect(shell.laneHeader).toContain("min-h-7");
		expect(shell.laneAction).toContain("min-h-7");
		expect(shell.titlebarControl).toContain("size-10");
		expect(shell.titlebarLauncher).toContain("size-10");
		expect(shell.macTrafficLightsInset).toContain("pl-20");
		expect(icon.windowControl).toBe("size-3.5");
		expect(icon.windowMaximize).toBe("size-3");
		expect(row.agent).toContain("min-h-8");
		expect(row.agent).toContain("relative");
		expect(row.agentActiveIndicator).toContain("h-4");
		expect(row.agentActiveIndicator).toContain("bg-foreground");
		expect(row.agentActiveIndicator).toContain("-left-1");
		expect(row.agentLeading).toContain("self-center");
		expect(row.projectHeader).toContain("min-h-9");
		expect(row.projectHeader).toContain("group/header");
		expect(row.searchResult).toContain("h-[52px]");
		expect(row.agentModel).toContain("max-w-28");
		expect(row.agentDetail).toContain("ml-[1.375rem]");
		expect(row.agentSpaceHeader).toContain("min-w-0");
		expect(row.agentAvatarStrip).toContain("flex-nowrap");
		expect(row.agentAvatarStrip).toContain("gap-0");
		expect(row.agentAvatarStrip).toContain("overflow-hidden");
		expect(row.agentOverflow).toContain("size-7");
		expect(row.agentSpaceDetail).toContain("pl-1.5");
		expect(field.time).toContain("w-44");
		expect(surface.active).not.toContain("ring-");
		expect(row.projectSummary).toContain("pl-8");
		expect(overlay.paletteViewport).toContain("max-h-[22rem]");
		expect(shell.sidebarSectionHeader).toContain("h-8");
		expect(tab.panelTrigger).toContain("px-3");
		expect(tab.terminalTrigger).toContain("text-[13px]");
		expect(tab.terminalLabel).toContain("max-w-[120px]");
		expect(field.search).toContain("items-center");
		expect(field.searchIcon).toContain("shrink-0");
		expect(field.searchLabel).toContain("flex-1");
		expect(field.searchShortcut).toContain("shrink-0");
	});

	it("exposes shared settings and editor roles", () => {
		expect(row.settings).toContain("md:grid-cols-[minmax(0,1fr)_auto]");
		expect(row.settingsNav).toContain("min-h-8");
		expect(row.settingsList).toContain("min-h-9");
		expect(row.settingsListLabel).toContain("truncate");
		expect(row.settingsListLabel).toContain("justify-start");
		expect(row.editorDisclosure).toContain("min-h-8");
		expect(row.choice).toContain("min-h-9");
		expect(row.choiceActive).toContain("bg-accent");
		expect(row.settingsChoiceCard).toContain("min-h-20");
		expect(field.editor).toContain("font-mono");
		expect(field.editorNumber).toContain("w-24");
		expect(field.editorSelect).toContain("min-w-0");
		expect(field.editorLabel).toContain("truncate");
		expect(field.editorLabelShort).toContain("w-24");
		expect(field.selectNarrow).toContain("max-w-full");
		expect(field.selectStandard).toContain("w-56");
		expect(field.selectWide).toContain("w-72");
		expect(tab.segmentedList).toContain("min-h-8");
		expect(tab.segmentedTrigger).toContain("min-h-7");
		expect(panel.settingsPreview).toContain("h-60");
		expect(panel.settingsBody).toContain("px-7");
	});
});
