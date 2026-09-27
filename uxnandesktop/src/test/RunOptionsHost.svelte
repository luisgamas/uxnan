<script lang="ts">
  // Test host: binds a RunOptionsPicker's values and shows what would be sent.
  import type { AgentModelOption } from "$shared/agents/agent-capabilities";
  import RunOptionsPicker from "$lib/components/RunOptionsPicker.svelte";

  let { options }: { options: AgentModelOption[] } = $props();
  let values = $state<Record<string, string | boolean>>({});
</script>

<RunOptionsPicker {options} bind:values />
<output data-testid="values">{JSON.stringify(values)}</output>
