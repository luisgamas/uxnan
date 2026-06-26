<script lang="ts">
  // Visual before/after for an image file's diff (spec 02c §4.2). Each side is a
  // base64 data URL, or null when that version doesn't exist (added file → no
  // before; deleted file → no after). Rendered by DiffPane in place of the text
  // diff for image extensions.
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import ImageIcon from "@lucide/svelte/icons/image";
  import ImageOffIcon from "@lucide/svelte/icons/image-off";

  let { old: oldSrc, new: newSrc }: { old: string | null; new: string | null } =
    $props();
</script>

<div class="grid h-full min-h-0 grid-cols-2 gap-2">
  <!-- Before (HEAD / index). -->
  <figure class="flex min-h-0 flex-col gap-1.5">
    <figcaption class={cn("flex items-center gap-1.5", text.section)}>
      <ImageIcon class="size-3.5 text-muted-foreground" />
      {i18n.t("diff.imageBefore")}
    </figcaption>
    <div class="ux-checker flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-md border border-border p-2">
      {#if oldSrc}
        <img src={oldSrc} alt={i18n.t("diff.imageBefore")} class="max-h-full max-w-full object-contain" />
      {:else}
        <div class={cn("flex flex-col items-center gap-1 p-4", text.meta)}>
          <ImageOffIcon class="size-5 text-emerald-600 dark:text-emerald-400" />
          {i18n.t("diff.imageAdded")}
        </div>
      {/if}
    </div>
  </figure>

  <!-- After (index / working tree). -->
  <figure class="flex min-h-0 flex-col gap-1.5">
    <figcaption class={cn("flex items-center gap-1.5", text.section)}>
      <ImageIcon class="size-3.5 text-muted-foreground" />
      {i18n.t("diff.imageAfter")}
    </figcaption>
    <div class="ux-checker flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-md border border-border p-2">
      {#if newSrc}
        <img src={newSrc} alt={i18n.t("diff.imageAfter")} class="max-h-full max-w-full object-contain" />
      {:else}
        <div class={cn("flex flex-col items-center gap-1 p-4", text.meta)}>
          <ImageOffIcon class="size-5 text-red-600 dark:text-red-400" />
          {i18n.t("diff.imageRemoved")}
        </div>
      {/if}
    </div>
  </figure>
</div>

<style>
  /* A light checkerboard so transparent PNGs are legible on any theme. */
  .ux-checker {
    background-image:
      linear-gradient(45deg, rgb(127 127 127 / 0.12) 25%, transparent 25%),
      linear-gradient(-45deg, rgb(127 127 127 / 0.12) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, rgb(127 127 127 / 0.12) 75%),
      linear-gradient(-45deg, transparent 75%, rgb(127 127 127 / 0.12) 75%);
    background-size: 16px 16px;
    background-position:
      0 0,
      0 8px,
      8px -8px,
      -8px 0;
  }
</style>
