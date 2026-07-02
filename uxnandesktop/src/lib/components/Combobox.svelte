<script module lang="ts">
  // A reusable searchable single-select (Combobox = Popover + Command) — the
  // pattern first grown inside FontPicker, extracted so any field with a longish
  // list (worktrees, branches, agents, models…) gets the same feel: a search
  // box, grouped options, comfortable padding and a check on the current value.
  // Values are plain strings (an id / path / name); render extras (a logo, a
  // muted meta) via the `itemPrefix` / `triggerContent` snippets.
  export interface ComboItem {
    /** Stable value carried by `onChange` and used for the selected check. */
    value: string;
    /** Primary text shown on the row and the trigger. */
    label: string;
    /** Extra terms the search should match (the value/path is often opaque). */
    keywords?: string[];
    /** Secondary muted text shown at the end of the row. */
    meta?: string;
    disabled?: boolean;
  }
  export interface ComboGroup {
    heading?: string;
    items: ComboItem[];
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Popover from "$lib/components/ui/popover";
  import * as Command from "$lib/components/ui/command";
  import { Button } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import ChevronsUpDownIcon from "@lucide/svelte/icons/chevrons-up-down";
  import CheckIcon from "@lucide/svelte/icons/check";

  let {
    value,
    groups,
    placeholder = "",
    searchPlaceholder = "",
    emptyText = "—",
    onChange,
    triggerClass = "",
    contentClass = "",
    align = "start",
    disabled = false,
    itemPrefix,
    triggerContent,
  }: {
    /** Currently selected value (empty/undefined shows the placeholder). */
    value: string | undefined;
    groups: ComboGroup[];
    placeholder?: string;
    searchPlaceholder?: string;
    emptyText?: string;
    onChange: (value: string) => void;
    triggerClass?: string;
    contentClass?: string;
    align?: "start" | "center" | "end";
    disabled?: boolean;
    /** Optional leading content per row + on the trigger (e.g. an agent logo). */
    itemPrefix?: Snippet<[ComboItem]>;
    /** Fully custom trigger body (replaces the default label rendering). */
    triggerContent?: Snippet<[ComboItem | undefined]>;
  } = $props();

  let open = $state(false);

  const current = $derived(
    groups.flatMap((g) => g.items).find((i) => i.value === value),
  );

  function choose(v: string) {
    onChange(v);
    open = false;
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="outline"
        role="combobox"
        aria-expanded={open}
        {disabled}
        class={cn("w-full justify-between font-normal", triggerClass)}
      >
        {#if triggerContent}
          {@render triggerContent(current)}
        {:else}
          <span class={cn("flex items-center gap-2 truncate", current ? "" : "text-muted-foreground")}>
            {#if current && itemPrefix}{@render itemPrefix(current)}{/if}
            <span class="truncate">{current?.label ?? placeholder}</span>
          </span>
        {/if}
        <ChevronsUpDownIcon class="ml-1 shrink-0 opacity-50" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class={cn("w-72 p-0", contentClass)} {align}>
    <Command.Root value={value}>
      <Command.Input placeholder={searchPlaceholder} />
      <Command.List class="uxnan-scroll max-h-72">
        <Command.Empty>{emptyText}</Command.Empty>
        {#each groups as group, gi (gi)}
          {#if group.items.length}
            <Command.Group heading={group.heading}>
              {#each group.items as item (item.value)}
                <Command.Item
                  value={item.value}
                  keywords={[item.label, item.meta ?? "", ...(item.keywords ?? [])].filter(Boolean)}
                  disabled={item.disabled}
                  onSelect={() => choose(item.value)}
                >
                  {#if itemPrefix}{@render itemPrefix(item)}{/if}
                  <span class={cn("flex-1 truncate", text.body)}>{item.label}</span>
                  {#if item.meta}
                    <span class={cn("shrink-0 truncate", text.meta)}>{item.meta}</span>
                  {/if}
                  {#if value === item.value}
                    <CheckIcon class="size-3.5 shrink-0 text-primary" />
                  {/if}
                </Command.Item>
              {/each}
            </Command.Group>
          {/if}
        {/each}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
