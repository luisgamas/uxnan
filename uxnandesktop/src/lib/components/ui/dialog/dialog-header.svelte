<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import { dialog } from "$lib/design";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="dialog-header"
	class={cn("flex flex-col gap-2", dialog.header, className)}
	{...restProps}
>
	{@render children?.()}
</div>
