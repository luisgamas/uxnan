<script lang="ts">
  // An agent's brand logo (SVG from static/agents/), falling back to a generic
  // Bot glyph for custom agents with no logo. Sized via the design tokens.
  import { agentLogoSrc } from "$lib/agentCatalog";
  import { cn } from "$lib/utils";
  import { icon } from "$lib/design";
  import BotIcon from "@lucide/svelte/icons/bot";

  let {
    logo,
    class: className,
  }: { logo?: string | null; class?: string } = $props();

  const src = $derived(agentLogoSrc(logo));
  // Fall back to the generic glyph when the SVG is missing (a catalog agent whose
  // brand logo hasn't been added yet) so a broken <img> never shows. Reset when
  // the source changes.
  let failed = $state(false);
  $effect(() => {
    void src;
    failed = false;
  });
</script>

{#if src && !failed}
  <img
    {src}
    alt=""
    class={cn(icon.button, "shrink-0 object-contain", className)}
    onerror={() => (failed = true)}
  />
{:else}
  <BotIcon class={cn(icon.button, "shrink-0 text-muted-foreground", className)} />
{/if}
