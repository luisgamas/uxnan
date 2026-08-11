import { describe, expect, it } from "vitest";

import { control, dialog, iconButton, overlay } from "$lib/design";

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
});
