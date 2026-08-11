<script lang="ts">
	import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";
	import type { ComponentProps } from "svelte";
	import { overlay } from "$lib/design";

	let {
		ref = $bindable(null),
		class: className,
		inset,
		...restProps
	}: ComponentProps<typeof ContextMenuPrimitive.GroupHeading> & {
		inset?: boolean;
	} = $props();
</script>

<ContextMenuPrimitive.GroupHeading
	bind:ref
	data-slot="context-menu-group-heading"
	data-inset={inset}
	class={cn("text-muted-foreground font-medium data-[inset]:pl-8", overlay.label, className)}
	{...restProps}
/>
