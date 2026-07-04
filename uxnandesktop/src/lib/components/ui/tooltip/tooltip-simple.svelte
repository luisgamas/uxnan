<script lang="ts">
	import { Tooltip as TooltipPrimitive } from "bits-ui";
	import TooltipContent from "./tooltip-content.svelte";

	let {
		title = "",
		side = "top",
		sideOffset = 4,
		delayDuration = 700,
		children,
	}: {
		title: string;
		side?: "top" | "right" | "bottom" | "left";
		sideOffset?: number;
		delayDuration?: number;
		children: import("svelte").Snippet<[Record<string, unknown>]>;
	} = $props();
</script>

<TooltipPrimitive.Root {delayDuration}>
	<TooltipPrimitive.Trigger>
		{#snippet child({ props })}
			{@render children(props)}
		{/snippet}
	</TooltipPrimitive.Trigger>
	<TooltipContent {side} {sideOffset}>
		{title}
	</TooltipContent>
</TooltipPrimitive.Root>
