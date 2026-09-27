<script lang="ts">
  // A message the person sent, in its bubble. A long one is clamped to its
  // first lines with a fade and a "Show more" under it, so a pasted log does
  // not push the conversation off the screen; "Show less" folds it back. Short
  // messages draw exactly as before. Copying (the message meta) always takes
  // the whole text.
  import { i18n } from "$lib/i18n";
  import { chat } from "$lib/design";
  import { cn } from "$lib/utils";

  let { text, class: className }: { text: string; class?: string } = $props();

  /** Lines a long message shows folded (20 px each, `leading-5`). */
  const FOLDED_LINES = 10;
  const LINE_PX = 20;

  let body = $state<HTMLDivElement | null>(null);
  let expanded = $state(false);
  let long = $state(false);

  // Measured, not guessed from the character count: wrapping depends on the
  // pane's width. Re-measured when the width changes.
  $effect(() => {
    const el = body;
    if (!el) return;
    void text;
    const measure = () => {
      long = el.scrollHeight > FOLDED_LINES * LINE_PX + 24;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });

  const folded = $derived(long && !expanded);
</script>

<div class={cn("flex max-w-[85%] flex-col items-end", className)}>
  <div
    bind:this={body}
    data-folded={folded ? "" : undefined}
    class={cn(
      chat.userBubble,
      "relative max-w-full overflow-hidden",
      folded && "[mask-image:linear-gradient(to_bottom,black_70%,transparent)]",
    )}
    style:max-height={folded ? `${FOLDED_LINES * LINE_PX + 16}px` : undefined}
  >{text}</div>
  {#if long}
    <button
      type="button"
      class="mt-0.5 rounded-sm px-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      aria-expanded={expanded}
      onclick={() => (expanded = !expanded)}
    >
      {expanded ? i18n.t("chat.showLess") : i18n.t("chat.showMore")}
    </button>
  {/if}
</div>
