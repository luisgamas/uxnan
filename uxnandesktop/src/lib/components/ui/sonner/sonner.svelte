<script lang="ts">
	import { Toaster as Sonner, type ToasterProps as SonnerProps } from "svelte-sonner";
	import { app } from "$lib/state/app.svelte";
	import { Icon } from "$lib/components/ui/icon";
	import Loader2Icon from "@hugeicons/core-free-icons/Loading03Icon";
	import CircleCheckIcon from "@hugeicons/core-free-icons/CircleCheckIcon";
	import OctagonXIcon from "@hugeicons/core-free-icons/OctagonXIcon";
	import InfoIcon from "@hugeicons/core-free-icons/InformationCircleIcon";
	import TriangleAlertIcon from "@hugeicons/core-free-icons/Alert01Icon";

	let { ...restProps }: SonnerProps = $props();
</script>

<Sonner
	theme={app.prefersDark() ? "dark" : "light"}
	class="toaster group"
	richColors
	style="--normal-bg: var(--color-popover); --normal-text: var(--color-popover-foreground); --normal-border: var(--color-border);"
	{...restProps}
>
	{#snippet loadingIcon()}
		<Icon icon={Loader2Icon} class="size-4 animate-spin" />
	{/snippet}
	{#snippet successIcon()}
		<Icon icon={CircleCheckIcon} class="size-4" />
	{/snippet}
	{#snippet errorIcon()}
		<Icon icon={OctagonXIcon} class="size-4" />
	{/snippet}
	{#snippet infoIcon()}
		<Icon icon={InfoIcon} class="size-4" />
	{/snippet}
	{#snippet warningIcon()}
		<Icon icon={TriangleAlertIcon} class="size-4" />
	{/snippet}
</Sonner>
