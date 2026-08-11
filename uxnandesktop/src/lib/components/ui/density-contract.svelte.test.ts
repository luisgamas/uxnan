import { describe, expect, it } from "vitest";

import { mount, mountWithProviders, until } from "../../../test/render";
import Button from "./button/button.svelte";
import Input from "./input/input.svelte";
import SelectFixture from "./density-contract-fixture.svelte";
import TooltipFixture from "./tooltip-contract-fixture.svelte";
import DialogFixture from "./dialog-contract-fixture.svelte";

describe("primitive density contract", () => {
	it.each([
		["xs", "h-7"],
		["sm", "h-8"],
		["default", "h-9"],
		["lg", "h-10"],
		["icon-xs", "size-7"],
		["icon-sm", "size-8"],
		["icon", "size-9"],
		["icon-lg", "size-10"],
	] as const)("renders Button %s at its named target", (size, target) => {
		const { screen: result } = mount(Button, { props: { size } });
		expect(result.getByRole("button").classList.contains(target)).toBe(true);
	});

	it("keeps Input at 36px by default and exposes a 32px compact role", () => {
		const { screen: result } = mount(Input, { props: { density: "compact" } });
		const input = result.getByRole("textbox");
		expect(input.getAttribute("data-density")).toBe("compact");
		expect(input.className).toContain("data-[density=compact]:h-8");
		expect(input.className).toContain("h-9");
	});

	it("preserves disabled and accessible Button semantics", () => {
		const { screen: result } = mount(Button, {
			props: { disabled: true, "aria-label": "Unavailable action" },
		});
		const button = result.getByRole("button", { name: "Unavailable action" });
		expect(button).toBeDisabled();
		expect(button.getAttribute("aria-label")).toBe("Unavailable action");
	});

	it("maps the Select compact alias to its 32px trigger role", () => {
		const { screen: result } = mount(SelectFixture);
		const trigger = result.getByRole("button");
		expect(trigger.getAttribute("data-size")).toBe("sm");
		expect(trigger.className).toContain("data-[size=sm]:h-8");
	});

	it("keeps dialog close at 32px and applies named width roles", () => {
		mount(DialogFixture);
		const content = document.body.querySelector('[data-slot="dialog-content"]');
		expect(content?.getAttribute("data-size")).toBe("large");
		expect(content?.className).toContain("sm:max-w-[600px]");
		expect(content?.className).toContain("max-w-[calc(100%-2rem)]");
		expect(document.body.querySelector('[data-slot="dialog-header"]')?.className).toContain("py-4");
		expect(document.body.querySelector('[data-slot="dialog-body"]')?.className).toContain("py-4");
		expect(document.body.querySelector('[data-slot="dialog-footer"]')?.className).toContain("p-3");
		const close = document.body.querySelector('[data-slot="dialog-close"]');
		expect(close?.className).toContain("size-8");
	});

	it("keeps one tooltip open and dismisses it when another trigger opens", async () => {
		const { screen: result, user } = mountWithProviders(TooltipFixture);
		await user.hover(result.getByRole("button", { name: "first" }));
		expect(document.body.querySelectorAll('[data-tooltip-content][data-state="instant-open"]')).toHaveLength(1);
		expect(document.body.querySelector('[data-tooltip-content][data-state="instant-open"]')).toHaveTextContent("First");
		await user.hover(result.getByRole("button", { name: "second" }));
		expect(document.body.querySelectorAll('[data-tooltip-content][data-state="instant-open"]')).toHaveLength(1);
		expect(document.body.querySelector('[data-tooltip-content][data-state="instant-open"]')).toHaveTextContent("Second");
	});

	it("dismisses a tooltip when its trigger is clicked", async () => {
		const { screen: result, user } = mountWithProviders(TooltipFixture);
		const first = result.getByRole("button", { name: "first" });
		await user.hover(first);
		await user.click(first);
		await until(
			() => document.body.querySelectorAll('[data-tooltip-content][data-state="instant-open"]').length === 0,
			{ label: "tooltip trigger-click dismissal" },
		);
	});

	it("dismisses a tooltip when an unrelated control receives a pointer click", async () => {
		const { screen: result, user } = mountWithProviders(TooltipFixture);
		await user.hover(result.getByRole("button", { name: "first" }));
		await user.click(result.getByRole("button", { name: "outside" }));
		await until(
			() => document.body.querySelectorAll('[data-tooltip-content][data-state="instant-open"]').length === 0,
			{ label: "tooltip unrelated-control dismissal" },
		);
	});

	it("dismisses a tooltip with Escape", async () => {
		const { screen: result, user } = mountWithProviders(TooltipFixture);
		await user.hover(result.getByRole("button", { name: "first" }));
		await user.keyboard("{Escape}");
		await until(
			() => document.body.querySelectorAll('[data-tooltip-content][data-state="instant-open"]').length === 0,
			{ label: "tooltip Escape dismissal" },
		);
	});

	it("supports keyboard focus and dismisses when focus leaves the trigger", async () => {
		const { screen: result, user } = mountWithProviders(TooltipFixture);
		const first = result.getByRole("button", { name: "first" });
		const second = result.getByRole("button", { name: "second" });
		await user.tab();
		expect(first).toHaveFocus();
		await until(
			() => document.body.querySelector('[data-tooltip-content][data-state="instant-open"]')?.textContent?.includes("First") ?? false,
			{ label: "keyboard tooltip opening" },
		);
		await user.tab();
		expect(second).toHaveFocus();
		await until(
			() => document.body.querySelectorAll('[data-tooltip-content][data-state="instant-open"]').length === 0,
			{ label: "keyboard tooltip focus dismissal" },
		);
	});
});
