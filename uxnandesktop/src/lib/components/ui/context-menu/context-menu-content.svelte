<script lang="ts">
	import { cn } from "$lib/utils.js";
	import { ContextMenu as ContextMenuPrimitive } from "bits-ui";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: ContextMenuPrimitive.ContentProps = $props();
</script>

<ContextMenuPrimitive.Portal>
	<ContextMenuPrimitive.Content
		bind:ref
		data-slot="context-menu-content"
		class={cn(
			"data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 bg-popover text-popover-foreground uxnan-scroll z-50 max-h-[24rem] min-w-44 max-w-[min(20rem,90vw)] overflow-x-hidden overflow-y-auto rounded-lg p-1 shadow-md ring-1 outline-none duration-100 data-closed:overflow-hidden",
			className
		)}
		{...restProps}
	/>
</ContextMenuPrimitive.Portal>
