<script lang="ts">
  // Searchable model picker for Settings → AI commit, built as the idiomatic
  // shadcn-svelte Combobox (Popover + Command). OpenCode/Pi can report hundreds
  // of `provider/model` ids, so Command's built-in filtering + a scrollable list
  // keep it usable; the trigger stays `w-56` to match the sibling Select fields.
  // The first item is always "Default" (no model flag → the CLI's own model).
  import * as Popover from "$lib/components/ui/popover";
  import * as Command from "$lib/components/ui/command";
  import { Button } from "$lib/components/ui/button";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
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

  // Many CLIs report `provider/model` (or `provider/group/model`) ids where the
  // shared provider prefix is the *least* distinguishing part — truncating from
  // the right hides the model name. Split it: the last `/` segment is the model
  // (shown prominently), the rest is the provider (shown muted). Ids without a
  // `/` (Claude/Gemini friendly names) stay as-is with no provider line.
  const modelName = (s: string) => {
    const i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(i + 1) : s;
  };
  const modelProvider = (s: string) => {
    const i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(0, i) : "";
  };

  const label = $derived(
    value
      ? modelName(models.find((m) => m.id === value)?.displayName ?? value)
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
  <Popover.Content class="w-80 p-0" align="start">
    <Command.Root value={value || DEFAULT}>
      <Command.Input placeholder={i18n.t("settings.aiCommitModelSearch")} />
      <!-- `uxnan-scroll` = the app's thin scrollbar (the registry's `no-scrollbar`
           utility isn't defined in this project, so the list would otherwise show
           the native one). -->
      <Command.List class="uxnan-scroll">
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
              <TooltipSimple title={m.id}>
                {#snippet children(tp)}
                  <div {...tp} class="flex min-w-0 flex-1 flex-col">
                <span class="truncate">{modelName(m.displayName)}</span>
                {#if modelProvider(m.displayName)}
                  <span class="truncate text-xs text-muted-foreground">
                    {modelProvider(m.displayName)}
                  </span>
                {/if}
              </div>
                {/snippet}
              </TooltipSimple>
            </Command.Item>
          {/each}
        </Command.Group>
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
