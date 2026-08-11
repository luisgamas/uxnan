<script lang="ts">
	import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";
	import { registerOverlay } from "$lib/overlayLayer.js";
	import { overlay } from "$lib/design";

	let {
		ref = $bindable(null),
		class: className,
		width = "standard",
		...restProps
	}: ContextMenuPrimitive.SubContentProps & {
		width?: "simple" | "standard" | "wide";
	} = $props();

	// A submenu reaches past its parent menu — register it too, so it can't land
	// behind the integrated browser's native window (see `$lib/overlayLayer`).
	$effect(() => registerOverlay(ref));
</script>

<ContextMenuPrimitive.SubContent
	bind:ref
	data-slot="context-menu-sub-content"
	class={cn(
		"data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 w-auto z-50 shadow-lg duration-100",
		overlay.menuSurface,
		overlay.menuSubViewport,
		width === "simple" ? overlay.menuSimple : width === "wide" ? overlay.menuWide : overlay.menuStandard,
		className
	)}
	{...restProps}
/>
