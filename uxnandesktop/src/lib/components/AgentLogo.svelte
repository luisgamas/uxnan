<script lang="ts">
  // An agent's brand logo, resolved through a fallback chain: a user's custom
  // logo → the bundled SVG (static/agents/) → the product's favicon → a generic
  // Bot glyph. Each candidate that fails to load advances to the next; when all
  // are exhausted the Bot shows, so a broken <img> never appears. Sized via tokens.
  import { agentIconSources } from "$lib/agentCatalog";
  import { cn } from "$lib/utils";
  import { icon } from "$lib/design";
  import BotIcon from "@lucide/svelte/icons/bot";

  let {
    logo,
    class: className,
  }: { logo?: string | null; class?: string } = $props();

  const sources = $derived(agentIconSources(logo));
  // Index into `sources`; onerror advances it. Reset when the key changes.
  let idx = $state(0);
  $effect(() => {
    void sources;
    idx = 0;
  });
  const src = $derived(sources[idx]);
</script>

{#if src}
  <img
    {src}
    alt=""
    class={cn(icon.button, "shrink-0 object-contain", className)}
    onerror={() => (idx += 1)}
  />
{:else}
  <BotIcon class={cn(icon.button, "shrink-0 text-muted-foreground", className)} />
{/if}
