<script lang="ts">
  // The files a message carries (not its images): one chip each, the file's
  // name and size, right-aligned under the message like its images.
  import { Icon } from "$lib/components/ui/icon";
  import File01Icon from "@hugeicons/core-free-icons/File01Icon";
  import { formatBytes } from "$lib/bridge/fileAttachment";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";

  let {
    files,
    class: className,
  }: { files: { id: string; name: string; bytes: number }[]; class?: string } = $props();
</script>

{#if files.length > 0}
  <div class={cn("flex max-w-[85%] flex-wrap justify-end gap-1.5", className)}>
    {#each files as file (file.id)}
      <span
        class="flex h-11 max-w-60 items-center gap-2 rounded-lg bg-muted/60 px-2.5 ring-1 ring-border/60"
        title={file.name}
      >
        <Icon icon={File01Icon} class={cn(icon.action, "shrink-0 text-muted-foreground")} />
        <span class="flex min-w-0 flex-col">
          <span class={cn(text.body, "truncate")}>{file.name}</span>
          <span class={text.meta}>{formatBytes(file.bytes)}</span>
        </span>
      </span>
    {/each}
  </div>
{/if}
