<script lang="ts">
	import { Command as CommandPrimitive, useId } from "bits-ui";
	import { cn } from "$lib/utils.js";
	import { overlay } from "$lib/design";

	let {
		ref = $bindable(null),
		class: className,
		children,
		heading,
		value,
		...restProps
	}: CommandPrimitive.GroupProps & {
		heading?: string;
	} = $props();
</script>

<CommandPrimitive.Group
	bind:ref
	data-slot="command-group"
	class={cn("text-foreground **:[[cmdk-group-heading]]:text-muted-foreground overflow-hidden p-1", className)}
	value={value ?? heading ?? `----${useId()}`}
	{...restProps}
>
	{#if heading}
		<CommandPrimitive.GroupHeading
			class={cn("text-muted-foreground font-medium", overlay.label)}
		>
			{heading}
		</CommandPrimitive.GroupHeading>
	{/if}
	<CommandPrimitive.GroupItems {children} />
</CommandPrimitive.Group>
