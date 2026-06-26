<script lang="ts">
  // Searchable model picker for Settings → AI commit, built as the idiomatic
  // shadcn-svelte Combobox (Popover + Command). OpenCode/Pi can report hundreds
  // of `provider/model` ids, so Command's built-in filtering + a scrollable list
  // keep it usable; the trigger stays `w-56` to match the sibling Select fields.
  // The first item is always "Default" (no model flag → the CLI's own model).
  import * as Popover from "$lib/components/ui/popover";
  import * as Command from "$lib/components/ui/command";
  import { Button } from "$lib/components/ui/button";
  import { i18n } from "$lib/i18n";
  import type { AgentModel } from "$lib/types";
  import ChevronsUpDownIcon from "@lucide/svelte/icons/chevrons-up-down";

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

  // Command needs a non-empty value for the Default item; map "" ↔ this sentinel.
  const DEFAULT = "__default__";
  let open = $state(false);

  const label = $derived(
    value
      ? (models.find((m) => m.id === value)?.displayName ?? value)
      : i18n.t("settings.aiCommitModelDefault"),
  );

  function choose(id: string) {
    onSelect(id);
    open = false;
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <!-- {...props} first, then class — otherwise the trigger's own (empty)
           class wins and the button loses its width, stretching full-width. -->
      <Button
        {...props}
        variant="outline"
        role="combobox"
        aria-expanded={open}
        class="w-56 justify-between font-normal"
      >
        <span class="truncate">
          {loading ? i18n.t("settings.aiCommitModelLoading") : label}
        </span>
        <ChevronsUpDownIcon class="ml-1 shrink-0 opacity-50" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-56 p-0" align="start">
    <Command.Root value={value || DEFAULT}>
      <Command.Input placeholder={i18n.t("settings.aiCommitModelSearch")} />
      <Command.List>
        <Command.Empty>{i18n.t("settings.aiCommitModelNoMatch")}</Command.Empty>
        <Command.Group>
          <Command.Item value={DEFAULT} onSelect={() => choose("")}>
            {i18n.t("settings.aiCommitModelDefault")}
          </Command.Item>
          {#each models as m (m.id)}
            <Command.Item
              value={m.id}
              keywords={[m.displayName]}
              onSelect={() => choose(m.id)}
            >
              <span class="min-w-0 flex-1 truncate" title={m.id}>
                {m.displayName}
              </span>
            </Command.Item>
          {/each}
        </Command.Group>
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
