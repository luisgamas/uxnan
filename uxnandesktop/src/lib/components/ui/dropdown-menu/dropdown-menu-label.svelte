<script lang="ts">
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";
	import { overlay } from "$lib/design";

	let {
		ref = $bindable(null),
		class: className,
		inset,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		inset?: boolean;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="dropdown-menu-label"
	data-inset={inset}
	class={cn("text-muted-foreground font-medium data-inset:pl-7 data-[inset]:pl-8", overlay.label, className)}
	{...restProps}
>
	{@render children?.()}
</div>
