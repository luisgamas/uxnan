<script lang="ts">
  // Test-only wrapper reproducing the app-level context providers a component
  // gets for free under `src/routes/+layout.svelte` — today just the tooltip
  // provider (bits-ui tooltips throw without one). Keep this in sync with the
  // layout if more app-wide providers appear.
  import { TooltipProvider } from "$lib/components/ui/tooltip";
  import type { Component } from "svelte";

  let {
    component,
    props = {},
  }: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component: Component<any, any, any>;
    props?: Record<string, unknown>;
  } = $props();

  const C = $derived(component);
</script>

<TooltipProvider>
  <C {...props} />
</TooltipProvider>
