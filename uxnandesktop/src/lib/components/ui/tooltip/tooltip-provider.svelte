<script lang="ts">
	import { Tooltip as TooltipPrimitive } from "bits-ui";

	let {
		delayDuration = 700,
		skipDelayDuration = 0,
		disableHoverableContent = true,
		disableCloseOnTriggerClick = false,
		ignoreNonKeyboardFocus = true,
		...restProps
	}: TooltipPrimitive.ProviderProps = $props();
</script>

<TooltipPrimitive.Provider
	{delayDuration}
	{skipDelayDuration}
	{disableHoverableContent}
	{disableCloseOnTriggerClick}
	{ignoreNonKeyboardFocus}
	{...restProps}
/>
