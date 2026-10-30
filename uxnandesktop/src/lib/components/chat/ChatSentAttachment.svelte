<script lang="ts" module>
  /** How much of a text file its preview shows. */
  const PREVIEW_CHARS = 4000;

  /** The start of a text file's `data:` URL, decoded. */
  export function textPreviewOf(dataUrl: string): string {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    try {
      // Twice the characters in bytes covers multi-byte text; whole base64 quads only.
      const binary = atob(base64.slice(0, Math.ceil((PREVIEW_CHARS * 2) / 3) * 4));
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
    } catch {
      return "";
    }
  }
</script>

<script lang="ts">
  // NOTE: this component sits inside a `white-space: pre-wrap` bubble, so the
  // markup leaves no whitespace between the parts that render nothing in the
  // line (the hover card's portaled content, the dialog) — a stray space would
  // show beside the chip.
  //
  // An image or file inside a sent message, where it was written. Resting on
  // an image shows it whole in a hover card, and a click opens it in a
  // dialog; resting on a text file shows its first lines. The chip itself is
  // the composer's (`ChatAttachmentChip`), so a message reads the same before
  // and after it is sent.
  import * as HoverCard from "$lib/components/ui/hover-card";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Spinner } from "$lib/components/ui/spinner";
  import ChatAttachmentChip from "./ChatAttachmentChip.svelte";
  import { isTextAttachment } from "./attachmentIcon";
  import type { ChatChip } from "$lib/bridge/inlineMessage";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat, focus, text } from "$lib/design";

  let { chip }: { chip: ChatChip } = $props();

  /** The image's URL once loaded; `null` when it could not be had. */
  let url = $state<string | null | undefined>(undefined);
  let previewText = $state<string | null>(null);
  let open = $state(false);
  let shown = $state(false);

  const isImage = $derived(chip.kind === "image");
  const readable = $derived(!isImage && isTextAttachment(chip.name, chip.mimeType));

  // An image's thumbnail is part of the message: load it with it.
  $effect(() => {
    if (!isImage) return;
    let current = true;
    chip.load().then(
      (loaded) => current && (url = loaded),
      () => current && (url = null),
    );
    return () => {
      current = false;
    };
  });

  // A text file's lines only when someone looks.
  $effect(() => {
    if (!open || !readable || previewText !== null) return;
    chip.load().then(
      (loaded) => (previewText = textPreviewOf(loaded)),
      () => (previewText = ""),
    );
  });
</script>

{#if isImage || readable}
  <HoverCard.Root bind:open openDelay={250} closeDelay={100}>
    <HoverCard.Trigger>
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          class={cn("inline rounded-md align-baseline", focus.ring)}
          aria-label={isImage ? i18n.t("chat.chipOpen", { name: chip.name }) : chip.name}
          disabled={isImage && url === null}
          onclick={() => isImage && url && (shown = true)}
        >
          <ChatAttachmentChip
            name={chip.name}
            kind={chip.kind}
            mimeType={chip.mimeType}
            thumbUrl={url}
            unavailable={isImage && url === null}
          />
        </button>
      {/snippet}
    </HoverCard.Trigger><HoverCard.Content width="form" side="top" align="center" class="w-auto max-w-[min(26rem,80vw)] p-1.5">
      {#if isImage}
        {#if url}
          <img src={url} alt={chip.name} class={chat.attachmentPreview} />
        {:else if url === null}
          <p class={cn(text.meta, "p-2")}>{i18n.t("chat.imageUnavailable")}</p>
        {:else}
          <div class="flex size-24 items-center justify-center"><Spinner class="size-4 text-muted-foreground" /></div>
        {/if}
      {:else if previewText === null}
        <div class="flex h-16 w-48 items-center justify-center"><Spinner class="size-4 text-muted-foreground" /></div>
      {:else}
        <pre class={cn(chat.output, "m-0 max-h-56 w-[24rem] max-w-full whitespace-pre-wrap")}>{previewText}</pre>
      {/if}
      <p class={cn(text.meta, "truncate px-1 pt-1")}>{chip.name}</p>
    </HoverCard.Content>
  </HoverCard.Root>
{:else}
  <ChatAttachmentChip name={chip.name} kind={chip.kind} mimeType={chip.mimeType} />
{/if}{#if isImage}<Dialog.Root open={shown} onOpenChange={(next) => !next && (shown = false)}>
    <Dialog.Content size="large">
      <Dialog.Header>
        <Dialog.Title class={cn(text.title, "truncate")}>{chip.name}</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body class="pb-5">
        {#if url}
          <img src={url} alt={chip.name} class="max-h-[70vh] w-full rounded-md object-contain" />
        {/if}
      </Dialog.Body>
    </Dialog.Content>
  </Dialog.Root>
{/if}
