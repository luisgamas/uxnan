<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import { Icon } from "$lib/components/ui/icon";
	import ChevronRightIcon from "@hugeicons/core-free-icons/ChevronRightIcon";
	import { cn } from "$lib/utils.js";
	import { overlay } from "$lib/design";

	let {
		ref = $bindable(null),
		class: className,
		inset,
		children,
		...restProps
	}: DropdownMenuPrimitive.SubTriggerProps & {
		inset?: boolean;
	} = $props();
</script>

<DropdownMenuPrimitive.SubTrigger
	bind:ref
	data-slot="dropdown-menu-sub-trigger"
	data-inset={inset}
	class={cn(
		"focus:bg-accent focus:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground gap-1.5 data-inset:pl-7 [&_svg:not([class*='size-'])]:size-4 flex cursor-default items-center outline-hidden select-none data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0",
		overlay.item,
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<Icon icon={ChevronRightIcon} class="ml-auto" />
</DropdownMenuPrimitive.SubTrigger>
