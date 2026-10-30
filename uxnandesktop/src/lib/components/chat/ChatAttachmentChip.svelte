<script lang="ts">
  // One image or file inside a message's text: its thumbnail (an image) or
  // its type's glyph (a file) and its name, shortened in the middle so the
  // extension stays. The same chip draws in the composer — where the editor
  // copies it into its text and gives it a ✕ — and in the sent message.
  import { Icon } from "$lib/components/ui/icon";
  import CancelIcon from "@hugeicons/core-free-icons/Cancel01Icon";
  import Image01Icon from "@hugeicons/core-free-icons/Image01Icon";
  import ImageNotFoundIcon from "@hugeicons/core-free-icons/ImageNotFound01Icon";
  import { shortName } from "$lib/bridge/composerAttachments";
  import { attachmentIcon } from "./attachmentIcon";
  import { cn } from "$lib/utils";
  import { chat } from "$lib/design";

  let {
    name,
    kind,
    mimeType = "",
    thumbUrl,
    unavailable = false,
    removeLabel,
    class: className,
  }: {
    name: string;
    kind: "image" | "file";
    mimeType?: string;
    /** The image's URL, once there is one. In the composer the editor sets it
     *  itself (`data-chip-thumb`), so the pixels stay out of its history. */
    thumbUrl?: string | null;
    /** The image could not be had (gone from the bridge). */
    unavailable?: boolean;
    /** With a label, the chip has a ✕ that removes it (in the composer). */
    removeLabel?: string;
    class?: string;
  } = $props();
</script>

<span class={cn(chat.attachmentChip, className)} title={name} data-chip-kind={kind}>
  {#if kind === "image"}
    {#if unavailable}
      <Icon icon={ImageNotFoundIcon} class={chat.attachmentChipGlyph} />
    {:else}
      <span class={cn(chat.attachmentChipThumb, "relative overflow-hidden bg-muted")}>
        <Icon icon={Image01Icon} class="absolute inset-0 m-auto size-3 text-muted-foreground" />
        <img
          data-chip-thumb=""
          src={thumbUrl ?? undefined}
          alt=""
          class={cn("absolute inset-0 size-full object-cover", !thumbUrl && "hidden")}
        />
      </span>
    {/if}
  {:else}
    <Icon icon={attachmentIcon(name, mimeType)} class={chat.attachmentChipGlyph} />
  {/if}
  <span class="min-w-0 truncate">{shortName(name)}</span>
  {#if removeLabel}
    <button
      type="button"
      tabindex="-1"
      data-chip-action="remove"
      class={chat.attachmentChipRemove}
      aria-label={removeLabel}
      title={removeLabel}
    >
      <Icon icon={CancelIcon} class="size-3" />
    </button>
  {/if}
</span>
