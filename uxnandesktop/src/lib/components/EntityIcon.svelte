<script lang="ts">
  // Renders a project's or branch's icon value through one resolution chain:
  //   1. a `builtin:<name>[~<color>]` key → the curated lucide glyph (tinted);
  //   2. a custom image (`data:` / `http(s):` URL) → an <img> that falls back to
  //      the default glyph if it fails to load (so a broken image never shows);
  //   3. otherwise → the caller's `fallback` snippet (its default folder/branch
  //      glyph).
  // Sizing is the caller's via `class` (applied to every branch), so it slots
  // into a sidebar row, a menu item or a settings preview unchanged.
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";
  import { isCustomLogo } from "$lib/logo";
  import { resolveBuiltinIcon } from "$lib/iconRegistry";

  let {
    value,
    class: className,
    fallback,
  }: {
    /** The stored icon value (builtin key, custom image URL, or null). */
    value?: string | null;
    /** Size/positioning classes applied to whichever variant renders. */
    class?: string;
    /** The default glyph, shown when there's no custom icon (or it fails). */
    fallback: Snippet;
  } = $props();

  const builtin = $derived(resolveBuiltinIcon(value));
  const isImage = $derived(!builtin && isCustomLogo(value));
  // <img> onerror advances this so a dead image drops to the fallback glyph.
  let failed = $state(false);
  $effect(() => {
    void value;
    failed = false;
  });
</script>

{#if builtin}
  {@const Icon = builtin.Icon}
  <Icon class={cn("shrink-0", className)} style={builtin.color ? `color:${builtin.color}` : undefined} />
{:else if isImage && !failed}
  <img
    src={value}
    alt=""
    class={cn("shrink-0 rounded-[3px] object-contain", className)}
    onerror={() => (failed = true)}
  />
{:else}
  {@render fallback()}
{/if}
