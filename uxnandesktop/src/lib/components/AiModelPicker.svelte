<script lang="ts">
  // Searchable, scrollable model picker for Settings → AI commit. OpenCode and Pi
  // can report hundreds of `provider/model` ids — far more than fit in a plain
  // dropdown — so this is a Popover with a filter box and a capped, scrollable
  // list instead of a `Select`. The first entry is always "Default" (no model
  // flag → the CLI uses its own configured model).
  import * as Popover from "$lib/components/ui/popover";
  import { Button } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import type { AgentModel } from "$lib/types";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import CheckIcon from "@lucide/svelte/icons/check";
  import SearchIcon from "@lucide/svelte/icons/search";

  let {
    models,
    value,
    loading = false,
    onSelect,
  }: {
    /** Models the agent reports (Default is added by this component). */
    models: AgentModel[];
    /** Selected model id; "" = Default (the CLI's own model). */
    value: string;
    /** A model-list query is in flight. */
    loading?: boolean;
    onSelect: (id: string) => void;
  } = $props();

  let open = $state(false);
  let query = $state("");

  const label = $derived(
    value
      ? (models.find((m) => m.id === value)?.displayName ?? value)
      : i18n.t("settings.aiCommitModelDefault"),
  );
  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.displayName.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    );
  });
  function choose(id: string) {
    onSelect(id);
    open = false;
    query = "";
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button variant="outline" class="w-56 justify-between font-normal" {...props}>
        <span class="truncate">
          {loading ? i18n.t("settings.aiCommitModelLoading") : label}
        </span>
        <ChevronDownIcon class={cn(icon.button, "ml-1 shrink-0 opacity-60")} />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-56 p-0" align="start">
    <div class="flex items-center gap-1.5 border-b border-border px-2">
      <SearchIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
      <!-- svelte-ignore a11y_autofocus -->
      <input
        autofocus
        bind:value={query}
        placeholder={i18n.t("settings.aiCommitModelSearch")}
        class={cn(
          "h-8 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60",
          text.body,
        )}
      />
    </div>
    <div class="uxnan-scroll max-h-[40vh] overflow-y-auto p-1">
      <!-- Default is always reachable (hidden only while actively filtering). -->
      {#if !query.trim()}
        <button
          type="button"
          class={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent",
            text.body,
          )}
          onclick={() => choose("")}
        >
          <CheckIcon class={cn(icon.button, value ? "opacity-0" : "opacity-100")} />
          {i18n.t("settings.aiCommitModelDefault")}
        </button>
      {/if}
      {#each filtered as m (m.id)}
        <button
          type="button"
          class={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent",
            text.body,
          )}
          title={m.id}
          onclick={() => choose(m.id)}
        >
          <CheckIcon class={cn(icon.button, "shrink-0", value === m.id ? "opacity-100" : "opacity-0")} />
          <span class="min-w-0 flex-1 truncate">{m.displayName}</span>
        </button>
      {:else}
        <p class={cn("px-2 py-1.5", text.meta)}>{i18n.t("settings.aiCommitModelNoMatch")}</p>
      {/each}
    </div>
  </Popover.Content>
</Popover.Root>
