<script lang="ts">
  // An agent's brand logo, resolved through a fallback chain: a user's custom
  // logo → the bundled SVG (static/agents/) → the product's favicon → a generic
  // Bot glyph. A bundled candidate that fails to load advances the chain via
  // `onerror`; a remote one (the favicon) can't be loaded by the webview at all
  // under the app's CSP, so it is fetched by the backend and rendered as a
  // `data:` URL (see `$lib/agentLogoCache`). When everything is exhausted the Bot
  // shows, so a broken <img> never appears. Sized via tokens.
  import { agentIconSources } from "$lib/agentCatalog";
  import { isRemoteLogo, peekRemoteLogo, resolveRemoteLogo } from "$lib/agentLogoCache";
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
  const candidate = $derived(sources[idx]);
  /** Backend-fetched bytes for a remote candidate (null = unavailable). */
  let fetched = $state<string | null>(null);

  $effect(() => {
    const url = candidate;
    if (!url || !isRemoteLogo(url)) {
      fetched = null;
      return;
    }
    const known = peekRemoteLogo(url);
    if (known !== undefined) {
      fetched = known;
      return;
    }
    // Guard the async result against a logo that changed while it was in flight.
    let current = true;
    void resolveRemoteLogo(url).then((data) => {
      if (current) fetched = data;
    });
    return () => {
      current = false;
    };
  });

  // A remote candidate renders only once the backend has handed us the bytes;
  // while it's in flight (and if it fails) the Bot glyph stands in.
  const src = $derived(candidate && isRemoteLogo(candidate) ? fetched : candidate);
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
