<script lang="ts">
	import { Popover as PopoverPrimitive } from "bits-ui";
	import PopoverPortal from "./popover-portal.svelte";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import type { ComponentProps } from "svelte";
	import { registerOverlay } from "$lib/overlayLayer.js";
	import { overlay } from "$lib/design";

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 4,
		align = "center",
		width = "form",
		padding = "default",
		portalProps,
		...restProps
	}: PopoverPrimitive.ContentProps & {
		width?: "info" | "form" | "command" | "status";
		padding?: "default" | "none";
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof PopoverPortal>>;
	} = $props();

	// Hide the integrated browser's native window while this popover sits over it,
	// or it opens behind the page (see `$lib/overlayLayer`).
	$effect(() => registerOverlay(ref));
</script>

<PopoverPortal {...portalProps}>
	<PopoverPrimitive.Content
		bind:ref
		data-slot="popover-content"
		data-width={width}
		{sideOffset}
		{align}
		class={cn(
			"bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 flex flex-col gap-2.5 text-sm shadow-md ring-1 duration-100 data-[side=inline-start]:slide-in-from-right-2 data-[side=inline-end]:slide-in-from-left-2 z-50 origin-(--transform-origin) outline-hidden",
			cn(overlay.popover, padding === "none" ? overlay.popoverNoPadding : overlay.popoverPadding),
			width === "info" ? overlay.infoWidth : width === "status" ? overlay.statusWidth : overlay.commandWidth,
			className
		)}
		{...restProps}
	/>
</PopoverPortal>
