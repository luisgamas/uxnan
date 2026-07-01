<script lang="ts">
	import { LinkPreview as LinkPreviewPrimitive } from "bits-ui";

	let { ref = $bindable(null), ...restProps }: LinkPreviewPrimitive.TriggerProps = $props();
</script>

<LinkPreviewPrimitive.Trigger bind:ref data-slot="hover-card-trigger" {...restProps} />
