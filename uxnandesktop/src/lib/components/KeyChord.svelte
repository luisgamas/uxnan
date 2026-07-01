<script lang="ts">
  // Renders a keyboard chord as individual keycaps — each key its own <Kbd>, with
  // a faint "+" between them (non-mac) — so a combo like "Ctrl+," stays legible
  // instead of being crammed into a single cap. Pass the raw binding string
  // (e.g. "Mod+,"); `formatChordParts` maps Mod → Ctrl/⌘ per platform.
  import Kbd from "./Kbd.svelte";
  import { formatChordParts, isMac } from "$lib/keybindings";
  import { cn } from "$lib/utils";

  let {
    chord,
    class: className,
    kbdClass,
  }: { chord: string; class?: string; kbdClass?: string } = $props();

  const parts = $derived(formatChordParts(chord));
</script>

{#if parts.length}
  <span class={cn("inline-flex items-center gap-1", className)}>
    {#each parts as part, i (i)}
      {#if i > 0 && !isMac}
        <span class="text-[10px] font-medium text-muted-foreground/45" aria-hidden="true">+</span>
      {/if}
      <Kbd class={kbdClass}>{part}</Kbd>
    {/each}
  </span>
{/if}
