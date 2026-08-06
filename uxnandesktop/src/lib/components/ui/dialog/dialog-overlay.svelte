<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";
	import { registerOverlay } from "$lib/overlayLayer.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: DialogPrimitive.OverlayProps = $props();

	// The integrated browser's page is a native child window that paints above ALL
	// DOM, so a dialog would otherwise open *behind* it — and be unclickable there.
	// Registering the full-viewport scrim is what hides the browser for every modal
	// in the app (see `$lib/overlayLayer`).
	$effect(() => registerOverlay(ref));
</script>

<DialogPrimitive.Overlay
	bind:ref
	data-slot="dialog-overlay"
	class={cn("data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs fixed inset-0 isolate z-50", className)}
	{...restProps}
/>
