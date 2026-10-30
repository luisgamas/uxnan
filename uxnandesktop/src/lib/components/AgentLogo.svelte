<script lang="ts">
  // An agent's brand logo: a user's custom logo, else the agent's mark shipped
  // with the app (`static/agents/`, synced from the repository's single set in
  // `assets/agents/` — a drawn SVG or the vendored favicon PNG), else a generic
  // Bot glyph. Everything is local, so it renders offline and the CSP needs no
  // remote image host; a candidate that fails to load advances the chain via
  // `onerror`, so a broken <img> never appears. Sized via tokens.
  //
  // A drawn mark that is a single dark colour (`mono` in the catalog — Codex
  // draws with `currentColor`, which an <img> resolves to black) is inverted on
  // dark themes so it reads white there and stays dark on light ones. Only a
  // drawn mark is inverted: favicons and custom logos are left alone.
  import { agentIconSources, isMonochromeLogo } from "$lib/agentCatalog";
  import { cn } from "$lib/utils";
  import { icon } from "$lib/design";
  import { Icon } from "$lib/components/ui/icon";
  import BotIcon from "@hugeicons/core-free-icons/BotIcon";

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
  const invert = $derived(!!src && isMonochromeLogo(logo) && src.endsWith(".svg"));
</script>

{#if src}
  <img
    {src}
    alt=""
    class={cn(
      icon.button,
      "shrink-0 object-contain",
      invert && "dark:invert",
      className,
    )}
    onerror={() => (idx += 1)}
  />
{:else}
  <Icon icon={BotIcon} class={cn(icon.button, "shrink-0 text-muted-foreground", className)} />
{/if}
