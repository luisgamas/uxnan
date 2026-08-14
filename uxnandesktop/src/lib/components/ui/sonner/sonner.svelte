<script lang="ts">
	// The app's toasts, dressed as this desktop's own elevated surface.
	//
	// sonner's `richColors` paints a saturated, full-bleed card per type, which is
	// a different design language from the rest of the shell: neutral surfaces,
	// quiet hairlines, 12–13px text. Beside a panel it read as a web notification
	// dropped into a tool — the widest, loudest thing on screen for what is
	// usually one line.
	//
	// So the surface is ours (`--ux-elevated`, `border-border/60`, the overlay
	// shadow the design system gives popovers and dialogs) and the **icon** now
	// carries the meaning instead of the background. Same information, in the
	// shell's voice.
	import { Toaster as Sonner, type ToasterProps as SonnerProps } from "svelte-sonner";
	import { app } from "$lib/state/app.svelte";
	import { Icon } from "$lib/components/ui/icon";
	import Loader2Icon from "@hugeicons/core-free-icons/Loading03Icon";
	import CircleCheckIcon from "@hugeicons/core-free-icons/CircleCheckIcon";
	import OctagonXIcon from "@hugeicons/core-free-icons/OctagonXIcon";
	import InfoIcon from "@hugeicons/core-free-icons/InformationCircleIcon";
	import TriangleAlertIcon from "@hugeicons/core-free-icons/Alert01Icon";

	let { ...restProps }: SonnerProps = $props();

	// Popover radius, dialog-grade shadow, dense padding, body at 13px with the
	// description one step down and muted — the hierarchy every card here uses.
	const toastClass = [
		"group toast w-full items-start gap-2.5 rounded-lg border border-border/60",
		"bg-[var(--ux-elevated)] px-3 py-2.5 text-[13px] leading-5 text-foreground",
		"shadow-[0_10px_32px_rgb(0_0_0/0.12),0_4px_12px_rgb(0_0_0/0.08)]",
		"dark:shadow-[0_10px_32px_rgb(0_0_0/0.30),0_4px_16px_rgb(0_0_0/0.20)]",
	].join(" ");
</script>

<Sonner
	theme={app.prefersDark() ? "dark" : "light"}
	class="toaster group"
	toastOptions={{
		classes: {
			toast: toastClass,
			title: "text-[13px] font-medium leading-5",
			description: "text-[12px] leading-[1.15rem] text-muted-foreground",
			icon: "mt-0.5 shrink-0",
			// The type is said by the icon, not by a coloured card.
			error: "[&_[data-icon]]:text-destructive",
			success: "[&_[data-icon]]:text-emerald-600 dark:[&_[data-icon]]:text-emerald-500",
			warning: "[&_[data-icon]]:text-amber-600 dark:[&_[data-icon]]:text-amber-500",
			info: "[&_[data-icon]]:text-muted-foreground",
			actionButton: "h-7 rounded-md px-2 text-[12px] font-medium",
			cancelButton: "h-7 rounded-md px-2 text-[12px] text-muted-foreground",
			closeButton: "rounded-md border-border/60 bg-[var(--ux-elevated)]",
		},
	}}
	style="--normal-bg: var(--ux-elevated); --normal-text: var(--color-foreground); --normal-border: var(--color-border); --width: 22rem;"
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
