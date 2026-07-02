<script module lang="ts">
  import { listSystemFonts } from "$lib/api";

  // Shared across every FontPicker instance: the system font list is fetched
  // once (the Rust `list_system_fonts` command shells out to the OS), then all
  // pickers read the same cached `$state`.
  let systemFonts = $state<string[]>([]);
  let started = false;

  /** Fetch the installed system fonts once; subsequent calls are no-ops. */
  export async function ensureSystemFonts(): Promise<void> {
    if (started) return;
    started = true;
    try {
      systemFonts = await listSystemFonts();
    } catch {
      started = false; // allow a retry on a later open
    }
  }
</script>

<script lang="ts">
  // Reusable searchable font picker (Combobox = Popover + Command), used for
  // every UI/terminal font field in Settings. Lists the app's bundled faces
  // first, then the installed system fonts; each option previews in its own
  // family. The search box doubles as a free-text entry, so a family that isn't
  // installed locally (but exists on another machine / SSH host) can still be
  // chosen. Clearing returns to the theme default.
  import * as Popover from "$lib/components/ui/popover";
  import * as Command from "$lib/components/ui/command";
  import { Button } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import ChevronsUpDownIcon from "@lucide/svelte/icons/chevrons-up-down";
  import CheckIcon from "@lucide/svelte/icons/check";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";

  let {
    value,
    placeholder = "",
    bundled = [],
    clearLabel,
    onChange,
    triggerClass = "",
    align = "start",
  }: {
    /** Current family name; empty / undefined = use the theme default. */
    value: string | undefined;
    /** Inherited family shown (muted) on the trigger when nothing is set. */
    placeholder?: string;
    /** App-bundled families to surface above the installed ones (e.g. Geist). */
    bundled?: string[];
    /** Label for the "reset to default / inherit" item. */
    clearLabel: string;
    onChange: (value: string | undefined) => void;
    triggerClass?: string;
    align?: "start" | "center" | "end";
  } = $props();

  let open = $state(false);
  let query = $state("");

  // Load the list lazily the first time any picker is opened.
  $effect(() => {
    if (open) void ensureSystemFonts();
  });

  const current = $derived((value ?? "").trim());
  // Offer "Use <typed>" only when the query is a real custom family not already
  // present in either group (case-insensitive), so we don't duplicate a match.
  const known = $derived(
    new Set([...bundled, ...systemFonts].map((f) => f.toLowerCase())),
  );
  const customQuery = $derived(query.trim());
  const showCustom = $derived(
    customQuery.length > 0 && !known.has(customQuery.toLowerCase()),
  );

  function choose(family: string | undefined) {
    onChange(family && family.trim() ? family.trim() : undefined);
    open = false;
    query = "";
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
        class={cn("w-full justify-between font-normal", triggerClass)}
      >
        <span class={cn("truncate", current ? "" : "text-muted-foreground")} style:font-family={current ? `'${current}'` : undefined}>
          {current || placeholder}
        </span>
        <ChevronsUpDownIcon class="ml-1 shrink-0 opacity-50" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-72 p-0" {align}>
    <Command.Root value={current}>
      <Command.Input placeholder={i18n.t("appearance.fontSearch")} oninput={(e) => (query = e.currentTarget.value)} />
      <Command.List class="uxnan-scroll max-h-72">
        <Command.Empty>—</Command.Empty>

        <Command.Group>
          <Command.Item value="__default__" keywords={[clearLabel]} onSelect={() => choose(undefined)}>
            <RotateCcwIcon class="size-3.5 shrink-0 text-muted-foreground" />
            <span class={cn("flex-1 truncate", text.body)}>{clearLabel}</span>
            {#if !current}<CheckIcon class="size-3.5 shrink-0 text-primary" />{/if}
          </Command.Item>
        </Command.Group>

        {#if showCustom}
          <Command.Group>
            <Command.Item value={customQuery} onSelect={() => choose(customQuery)}>
              <span class={cn("flex-1 truncate", text.body)} style:font-family={`'${customQuery}'`}>
                {i18n.t("appearance.fontUse")} “{customQuery}”
              </span>
            </Command.Item>
          </Command.Group>
        {/if}

        {#if bundled.length}
          <Command.Group heading={i18n.t("appearance.fontBundled")}>
            {#each bundled as f (f)}
              <Command.Item value={f} onSelect={() => choose(f)}>
                <span class={cn("flex-1 truncate", text.body)} style:font-family={`'${f}'`}>{f}</span>
                {#if current === f}<CheckIcon class="size-3.5 shrink-0 text-primary" />{/if}
              </Command.Item>
            {/each}
          </Command.Group>
        {/if}

        {#if systemFonts.length}
          <Command.Group heading={i18n.t("appearance.fontInstalled")}>
            {#each systemFonts as f (f)}
              <Command.Item value={f} onSelect={() => choose(f)}>
                <span class={cn("flex-1 truncate", text.body)} style:font-family={`'${f}'`}>{f}</span>
                {#if current === f}<CheckIcon class="size-3.5 shrink-0 text-primary" />{/if}
              </Command.Item>
            {/each}
          </Command.Group>
        {/if}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
