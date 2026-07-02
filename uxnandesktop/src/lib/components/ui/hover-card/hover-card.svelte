<script lang="ts">
	import { LinkPreview as LinkPreviewPrimitive } from "bits-ui";

	// A hover-card (peek panel on hover/focus) — bits-ui's LinkPreview. Slightly
	// snappier than the library default so a quick hover reveals the details.
	let {
		open = $bindable(false),
		openDelay = 300,
		closeDelay = 100,
		...restProps
	}: LinkPreviewPrimitive.RootProps = $props();
</script>

<LinkPreviewPrimitive.Root bind:open {openDelay} {closeDelay} {...restProps} />
