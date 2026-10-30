<script lang="ts">
  // A message the person sent, in its bubble. A long one is clamped to its
  // first lines with a fade and a "Show more" under it, so a pasted log does
  // not push the conversation off the screen; "Show less" folds it back. Short
  // messages draw exactly as before. Copying (the message meta) always takes
  // the whole text.
  //
  // The images and files it carries sit inside the text, where they were
  // written (`inlineMessage.ts`); one without a place follows the text.
  import { i18n } from "$lib/i18n";
  import { messagePieces, type ChatChip } from "$lib/bridge/inlineMessage";
  import ChatSentAttachment from "./ChatSentAttachment.svelte";
  import { chat } from "$lib/design";
  import { cn } from "$lib/utils";

  let {
    text,
    attachments = [],
    queued = false,
    class: className,
  }: {
    text: string;
    /** The message's images and files, in the order of its markers. */
    attachments?: ChatChip[];
    /** Waiting in the queue: the same bubble, outlined instead of filled. */
    queued?: boolean;
    class?: string;
  } = $props();

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
    void attachments.length;
    const measure = () => {
      long = el.scrollHeight > FOLDED_LINES * LINE_PX + 24;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });

  const folded = $derived(long && !expanded);
  const pieces = $derived(messagePieces(text, attachments));
</script>

<div class={cn("flex max-w-[85%] flex-col items-end", className)}>
  <div
    bind:this={body}
    data-folded={folded ? "" : undefined}
    class={cn(
      queued ? chat.queuedBubble : chat.userBubble,
      "relative max-w-full overflow-hidden",
      folded && "[mask-image:linear-gradient(to_bottom,black_70%,transparent)]",
    )}
    style:max-height={folded ? `${FOLDED_LINES * LINE_PX + 16}px` : undefined}
  >{#each pieces as piece, i (i)}{#if piece.kind === "text"}{piece.text}{:else}{#if piece.trailing && i > 0 && pieces[i - 1]?.kind === "text"}<br />{/if}<ChatSentAttachment chip={piece.attachment} />{/if}{/each}</div>
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
