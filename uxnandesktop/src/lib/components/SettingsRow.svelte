<script lang="ts">
  // One control row inside a `SettingsSection` body: a label (+ optional helper
  // description) on the left, and the control aligned to the right on wide
  // screens (stacks on narrow ones). Rows separate with a quiet `divide-y` on the
  // parent — no per-row card — so divisions read only where they matter.
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";

  let {
    label,
    description,
    for: htmlFor,
    control,
    children,
    class: className,
  }: {
    label?: string;
    description?: string;
    /** Associates the label with a control id (for a11y), when given. */
    for?: string;
    /** The control, right-aligned on wide screens. */
    control?: Snippet;
    /** Extra content under the label (e.g. an inline editor), full-width. */
    children?: Snippet;
    class?: string;
  } = $props();
</script>

<div
  class={cn(
    "grid gap-x-6 gap-y-2 py-3.5 first:pt-0 last:pb-0 md:grid-cols-[1fr_auto] md:items-center",
    className,
  )}
>
  {#if label || description}
    <div class="min-w-0 space-y-0.5">
      {#if label}
        <label class={cn("block font-medium text-foreground", text.body)} for={htmlFor}>{label}</label>
      {/if}
      {#if description}
        <p class={cn("text-[12px] leading-5 text-muted-foreground")}>{description}</p>
      {/if}
    </div>
  {/if}
  {#if control}
    <div class="md:justify-self-end">{@render control()}</div>
  {/if}
  {#if children}
    <div class="md:col-span-2">{@render children()}</div>
  {/if}
</div>
