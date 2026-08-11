<script lang="ts">
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";
	import { Dialog as DialogPrimitive } from "bits-ui";
	import { Button } from "$lib/components/ui/button/index.js";
	import { i18n } from "$lib/i18n";
	import { dialog } from "$lib/design";

	let {
		ref = $bindable(null),
		class: className,
		children,
		showCloseButton = false,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		showCloseButton?: boolean;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="dialog-footer"
	class={cn(dialog.footer, "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
	{...restProps}
>
	{@render children?.()}
	{#if showCloseButton}
		<DialogPrimitive.Close>
			{#snippet child({ props })}
				<Button variant="outline" {...props}>{i18n.t("common.close")}</Button>
			{/snippet}
		</DialogPrimitive.Close>
	{/if}
</div>
