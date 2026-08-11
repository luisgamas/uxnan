<script lang="ts">
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import DropdownMenuPortal from "./dropdown-menu-portal.svelte";
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import type { ComponentProps } from "svelte";
	import { registerOverlay } from "$lib/overlayLayer.js";
	import { overlay } from "$lib/design";

	let {
		ref = $bindable(null),
		sideOffset = 4,
		align = "start",
		portalProps,
		width = "standard",
		class: className,
		...restProps
	}: DropdownMenuPrimitive.ContentProps & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DropdownMenuPortal>>;
		width?: "simple" | "standard" | "wide";
	} = $props();

	// Hide the integrated browser's native window while this menu sits over it,
	// or the menu opens behind the page (see `$lib/overlayLayer`).
	$effect(() => registerOverlay(ref));
</script>

<DropdownMenuPortal {...portalProps}>
	<DropdownMenuPrimitive.Content
		bind:ref
		data-slot="dropdown-menu-content"
		{sideOffset}
		{align}
		class={cn(
			"data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 z-50 w-(--bits-dropdown-menu-anchor-width) outline-none data-closed:overflow-hidden",
			overlay.menuSurface,
			overlay.menuViewport,
			width === "simple" ? overlay.menuSimple : width === "wide" ? overlay.menuWide : overlay.menuStandard,
			className
		)}
		{...restProps}
	/>
</DropdownMenuPortal>
