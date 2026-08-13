<script lang="ts">
  // One control row inside a `SettingsSection` body: a label (+ optional helper
  // description) on the left, and the control aligned to the right on wide
  // screens (stacks on narrow ones). Rows separate with a quiet `divide-y` on the
  // parent — no per-row card — so divisions read only where they matter.
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";
  import { row, text } from "$lib/design";

  let {
    label,
    description,
    for: htmlFor,
    leading,
    control,
    children,
    help,
    meta,
    class: className,
  }: {
    label?: string;
    description?: string;
    /** Associates the label with a control id (for a11y), when given. */
    for?: string;
    /** A mark before the label block (an agent logo, an entity icon), aligned
     *  to the first text line rather than to the row's vertical centre. */
    leading?: Snippet;
    /** The control, right-aligned on wide screens. */
    control?: Snippet;
    /** Extra content under the label (e.g. an inline editor), full-width. */
    children?: Snippet;
    /** Small trailing affordance next to the description (e.g. a help "?"). */
    help?: Snippet;
    /** Extra lines under the description, still inside the label cell (a path,
     *  a status note) — unlike `children`, they stay beside the control. */
    meta?: Snippet;
    class?: string;
  } = $props();
</script>

<div
  class={cn(
    row.settings,
    className,
  )}
>
  {#if leading || label || description || help || meta}
    <div class="flex min-w-0 items-start gap-2.5">
      {#if leading}<span class="mt-0.5 shrink-0">{@render leading()}</span>{/if}
      <div class="min-w-0 space-y-0.5">
        {#if label}
          <label class={cn("block font-medium text-foreground", text.body)} for={htmlFor}>{label}</label>
        {/if}
        {#if description || help}
          <div class="flex items-start gap-1.5">
            {#if description}
              <p class={cn("text-[12px] leading-5 text-muted-foreground")}>{description}</p>
            {/if}
            {#if help}<span class="shrink-0">{@render help()}</span>{/if}
          </div>
        {/if}
        {#if meta}{@render meta()}{/if}
      </div>
    </div>
  {/if}
  {#if control}
    <div class="md:justify-self-end">{@render control()}</div>
  {/if}
  {#if children}
    <div class="md:col-span-2">{@render children()}</div>
  {/if}
</div>
