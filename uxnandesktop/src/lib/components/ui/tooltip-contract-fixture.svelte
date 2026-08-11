<script lang="ts">
	import { TooltipSimple } from "./tooltip/index.js";
</script>

<TooltipSimple title="First" delayDuration={0}>
	{#snippet children(props)}
		<button aria-label="first" {...props}>First</button>
	{/snippet}
</TooltipSimple>
<TooltipSimple title="Second" delayDuration={0}>
	{#snippet children(props)}
		<button aria-label="second" {...props}>Second</button>
	{/snippet}
</TooltipSimple>
<button aria-label="outside">Outside</button>
