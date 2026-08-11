<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import { Icon } from "$lib/components/ui/icon";
	import MinusIcon from "@hugeicons/core-free-icons/MinusSignIcon";
	import CheckIcon from "@hugeicons/core-free-icons/CheckIcon";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import type { Snippet } from "svelte";
	import { overlay } from "$lib/design";

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		indeterminate = $bindable(false),
		class: className,
		children: childrenProp,
		...restProps
	}: WithoutChildrenOrChild<DropdownMenuPrimitive.CheckboxItemProps> & {
		children?: Snippet;
	} = $props();
</script>

<DropdownMenuPrimitive.CheckboxItem
	bind:ref
	bind:checked
	bind:indeterminate
	data-slot="dropdown-menu-checkbox-item"
	class={cn(
		"focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground gap-1.5 rounded-md pr-8 data-inset:pl-7 [&_svg:not([class*='size-'])]:size-4 relative flex cursor-default items-center outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
		overlay.item,
		className
	)}
	{...restProps}
>
	{#snippet children({ checked, indeterminate })}
		<span
			class="absolute right-2 flex items-center justify-center pointer-events-none"
			data-slot="dropdown-menu-checkbox-item-indicator"
		>
			{#if indeterminate}
				<Icon icon={MinusIcon}  />
			{:else if checked}
				<Icon icon={CheckIcon}  />
			{/if}
		</span>
		{@render childrenProp?.()}
	{/snippet}
</DropdownMenuPrimitive.CheckboxItem>
