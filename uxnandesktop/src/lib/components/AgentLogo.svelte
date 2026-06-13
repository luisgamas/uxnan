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
</script>

{#if src}
  <img {src} alt="" class={cn(icon.button, "shrink-0 object-contain", className)} />
{:else}
  <BotIcon class={cn(icon.button, "shrink-0 text-muted-foreground", className)} />
{/if}
