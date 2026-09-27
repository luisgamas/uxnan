<script lang="ts" module>
  /** One image of a user message: its key and how to get it as a `data:` URL. */
  export interface ChatImage {
    id: string;
    load: () => Promise<string>;
  }
</script>

<script lang="ts">
  // The images a user message carries, as thumbnails at its side; a click
  // shows one whole. A message being sent has them already; a stored one asks
  // the bridge, which keeps them with the turn (`chat.attachment`).
  import * as Dialog from "$lib/components/ui/dialog";
  import { Icon } from "$lib/components/ui/icon";
  import { Spinner } from "$lib/components/ui/spinner";
  import ImageNotFoundIcon from "@hugeicons/core-free-icons/ImageNotFound01Icon";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { focus, icon, text } from "$lib/design";

  let { images, class: className }: { images: ChatImage[]; class?: string } = $props();

  /** Each image's URL once loaded; `null` when it could not be. */
  let urls = $state<Record<string, string | null>>({});
  $effect(() => {
    for (const image of images) {
      if (image.id in urls) continue;
      image.load().then(
        (url) => (urls[image.id] = url),
        () => (urls[image.id] = null),
      );
    }
  });

  let shown = $state<string | null>(null);
  const shownUrl = $derived(shown ? urls[shown] : null);
</script>

<div class={cn("flex flex-wrap justify-end gap-1.5", className)}>
  {#each images as image, index (image.id)}
    {@const url = urls[image.id]}
    <button
      type="button"
      class={cn(
        "flex size-20 items-center justify-center overflow-hidden rounded-lg bg-muted ring-1 ring-border/60 transition-opacity hover:opacity-90",
        focus.ring,
      )}
      aria-label={i18n.t("chat.openImage", { n: index + 1 })}
      title={url === null ? i18n.t("chat.imageUnavailable") : undefined}
      disabled={!url}
      onclick={() => (shown = image.id)}
    >
      {#if url}
        <img src={url} alt="" class="size-full object-cover" />
      {:else if url === null}
        <Icon icon={ImageNotFoundIcon} class={cn(icon.action, "text-muted-foreground")} />
      {:else}
        <Spinner class={cn(icon.decorative, "text-muted-foreground")} />
      {/if}
    </button>
  {/each}
</div>

<Dialog.Root open={shown !== null} onOpenChange={(open) => !open && (shown = null)}>
  <Dialog.Content size="large">
    <Dialog.Header>
      <Dialog.Title class={text.title}>{i18n.t("chat.image")}</Dialog.Title>
    </Dialog.Header>
    <Dialog.Body class="pb-5">
      {#if shownUrl}
        <img src={shownUrl} alt="" class="max-h-[70vh] w-full rounded-md object-contain" />
      {/if}
    </Dialog.Body>
  </Dialog.Content>
</Dialog.Root>
