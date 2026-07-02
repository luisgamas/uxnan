<script lang="ts">
	import { cn } from "$lib/utils.js";
	import { LinkPreview as LinkPreviewPrimitive } from "bits-ui";

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 6,
		align = "start",
		...restProps
	}: LinkPreviewPrimitive.ContentProps = $props();
</script>

<LinkPreviewPrimitive.Portal>
	<LinkPreviewPrimitive.Content
		bind:ref
		data-slot="hover-card-content"
		{sideOffset}
		{align}
		class={cn(
			"data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 bg-popover text-popover-foreground z-50 w-72 rounded-lg p-3 shadow-md ring-1 outline-none duration-100",
			className
		)}
		{...restProps}
	/>
</LinkPreviewPrimitive.Portal>
