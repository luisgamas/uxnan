<script lang="ts">
	import { Tabs as TabsPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		value = $bindable(""),
		// Default to manual activation so a tab activates only on click / Enter / Space —
		// never on mere focus. On Windows a right-click focuses the trigger button, and
		// bits-ui's "automatic" mode would then switch tabs on that focus; "manual" makes
		// selecting a tab left-click-only, uniform across Windows/Linux/macOS. Any caller
		// may still override by passing `activationMode`.
		activationMode = "manual",
		class: className,
		...restProps
	}: TabsPrimitive.RootProps = $props();
</script>

<TabsPrimitive.Root
	bind:ref
	bind:value
	{activationMode}
	data-slot="tabs"
	class={cn("gap-2 group/tabs flex data-[orientation=horizontal]:flex-col", className)}
	{...restProps}
/>
