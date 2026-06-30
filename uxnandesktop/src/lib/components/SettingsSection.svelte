<script lang="ts">
  // Reusable settings section shell (clean-desktop pattern): a strong title +
  // description over a soft, softly-bordered body band — so each section reads as
  // an organized unit without heavy nested cards. Compose `SettingsRow`s inside.
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";
  import { panel, text } from "$lib/design";

  let {
    title,
    description,
    headerAction,
    children,
    class: className,
  }: {
    title: string;
    description?: string;
    /** Optional control aligned to the right of the header (e.g. a primary action). */
    headerAction?: Snippet;
    children: Snippet;
    class?: string;
  } = $props();
</script>

<section class={cn("space-y-5", className)}>
  <div class={panel.sectionHeader}>
    <div class="min-w-0 space-y-1.5">
      <h2 class={text.pageTitle}>{title}</h2>
      {#if description}
        <p class={cn("max-w-2xl text-[13px] leading-5 text-muted-foreground")}>{description}</p>
      {/if}
    </div>
    {#if headerAction}{@render headerAction()}{/if}
  </div>
  <div class={panel.settingsBody}>
    {@render children()}
  </div>
</section>
