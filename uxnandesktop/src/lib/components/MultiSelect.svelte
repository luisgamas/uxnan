<script lang="ts">
  // A reusable searchable MULTI-select (Popover + Command), the multi-value
  // sibling of `Combobox`. The field reads as a token input — chosen values are
  // compact removable chips and an "Add" trigger opens a searchable, grouped,
  // scroll-capped list — so it stays the same small size whether there are 3
  // options or 300 (unlike a fixed list, which grows unbounded). Shares the
  // `ComboItem` / `ComboGroup` shape with `Combobox`; render logos/icons for
  // both rows and chips via the `itemPrefix` snippet.
  import type { Snippet } from "svelte";
  import * as Popover from "$lib/components/ui/popover";
  import * as Command from "$lib/components/ui/command";
  import { Button } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { text } from "$lib/design";
  import type { ComboGroup, ComboItem } from "./Combobox.svelte";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import CheckIcon from "@lucide/svelte/icons/check";
  import XIcon from "@lucide/svelte/icons/x";

  let {
    groups,
    selected,
    onToggle,
    placeholder = "",
    addLabel = "",
    searchPlaceholder = "",
    emptyText = "—",
    contentClass = "",
    align = "start",
    closeOnSelect = false,
    itemPrefix,
  }: {
    groups: ComboGroup[];
    /** Currently selected values. */
    selected: string[];
    /** Toggle a value in/out of the selection (parent owns the array). */
    onToggle: (value: string) => void;
    /** Field placeholder shown on the trigger when nothing is selected. */
    placeholder?: string;
    /** Compact trigger label once at least one chip is present. */
    addLabel?: string;
    searchPlaceholder?: string;
    emptyText?: string;
    contentClass?: string;
    align?: "start" | "center" | "end";
    /** Close the popover after each pick instead of keeping it open for the next
     *  one. The trigger stays available to add more, but the list never lingers
     *  (or re-expands) after a selection — so a single pick doesn't force the user
     *  to click elsewhere to dismiss it. Reopen via the trigger to add another. */
    closeOnSelect?: boolean;
    /** Leading content for both the rows and the chips (e.g. an agent logo). */
    itemPrefix?: Snippet<[ComboItem]>;
  } = $props();

  let open = $state(false);

  function select(value: string): void {
    onToggle(value);
    if (closeOnSelect) open = false;
  }

  const allItems = $derived(groups.flatMap((g) => g.items));
  // Preserve the selection order (the order things were added).
  const selectedItems = $derived(
    selected
      .map((v) => allItems.find((i) => i.value === v))
      .filter((i): i is ComboItem => !!i),
  );
  const isPicked = (v: string) => selected.includes(v);
</script>

<div
  class="flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-border bg-background px-1.5 py-1.5 shadow-xs transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
>
  {#each selectedItems as item (item.value)}
    <span
      class="inline-flex max-w-full items-center gap-1 rounded-md bg-foreground/[0.06] py-0.5 pl-1.5 pr-1 text-xs text-foreground"
    >
      {#if itemPrefix}{@render itemPrefix(item)}{/if}
      <span class="truncate">{item.label}</span>
      <TooltipSimple title={item.label}>
        {#snippet children(tp)}
          <button
            {...tp}
            type="button"
            class="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            aria-label={item.label}
            onclick={() => onToggle(item.value)}
          >
            <XIcon class="size-3" />
          </button>
        {/snippet}
      </TooltipSimple>
    </span>
  {/each}

  <Popover.Root bind:open>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          size="sm"
          class="h-6 gap-1 px-1.5 text-xs font-normal text-muted-foreground hover:text-foreground"
        >
          <PlusIcon class="size-3.5" />
          <span class="truncate">{selectedItems.length ? addLabel : placeholder}</span>
        </Button>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content class={cn("w-72 p-0", contentClass)} {align}>
      <Command.Root>
        <Command.Input placeholder={searchPlaceholder} />
        <Command.List class="uxnan-scroll max-h-72">
          <Command.Empty>{emptyText}</Command.Empty>
          {#each groups as group, gi (gi)}
            {#if group.items.length}
              <Command.Group heading={group.heading}>
                {#each group.items as item (item.value)}
                  {@const picked = isPicked(item.value)}
                  <Command.Item
                    value={item.value}
                    keywords={[item.label, item.meta ?? "", ...(item.keywords ?? [])].filter(Boolean)}
                    disabled={item.disabled}
                    onSelect={() => select(item.value)}
                  >
                    {#if itemPrefix}{@render itemPrefix(item)}{/if}
                    <span class={cn("flex-1 truncate", text.body, picked ? "text-foreground" : "")}>
                      {item.label}
                    </span>
                    {#if item.meta}
                      <span class={cn("shrink-0 truncate", text.meta)}>{item.meta}</span>
                    {/if}
                    <CheckIcon class={cn("size-3.5 shrink-0 text-primary", picked ? "" : "opacity-0")} />
                  </Command.Item>
                {/each}
              </Command.Group>
            {/if}
          {/each}
        </Command.List>
      </Command.Root>
    </Popover.Content>
  </Popover.Root>
</div>
