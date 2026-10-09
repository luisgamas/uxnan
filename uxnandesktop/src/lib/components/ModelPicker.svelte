<script lang="ts" module>
  /** An agent the picker can switch to (`agents`): the composer of a new chat. */
  export interface PickerAgent {
    id: string;
    label: string;
    /** Logo key for `AgentLogo`. */
    logo?: string | null;
    /** Installed and runnable; one that is not stays visible, dimmed. */
    available: boolean;
    /** Why it cannot be picked ("Not installed"). */
    note?: string;
  }
</script>

<script lang="ts">
  import { untrack } from "svelte";
  // The app's one model picker — Settings → AI commit, GitHub PR drafts,
  // orchestration steps and the chat composer. A trigger showing the chosen
  // model opens a compact menu of the models, searchable and grouped by
  // provider — OpenCode and pi report hundreds of `provider/model` ids, where
  // the provider prefix is the least distinguishing part, so rows show the
  // model and the group names the provider. The first row is "Default model"
  // (no model flag: the CLI's own). A model's run options (reasoning effort,
  // …) have their own picker beside it, `RunOptionsPicker`.
  //
  // Given `agents`, it is the composer's agent + model picker: the trigger
  // leads with the agent's logo, and with more than one agent the menu grows a
  // rail of their logos beside the list. Pointing at another agent shows its
  // models (`modelsOf`, loaded on demand through `onBrowse`); picking one picks
  // that agent too (`onSelect`'s second argument). An agent that is not
  // installed stays on the rail, dimmed, with its reason as a tooltip.
  //
  // Models the CLI calls older (`isLegacy`: a previous generation still on
  // offer) fold under one "Older models" row at the end of the list, opened
  // with a click — already open when the chosen model is one of them, and
  // flattened into the results while searching.
  //
  // Composed from the shared primitives: `Popover` + `Command` (type to
  // filter, arrows, Enter), `Button` for the trigger — `field` in a form
  // (outline, sized by `triggerClass`), `pill` in a toolbar (`chat.pill`:
  // ghost until hovered).
  import * as Popover from "$lib/components/ui/popover";
  import * as Command from "$lib/components/ui/command";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import { Spinner } from "$lib/components/ui/spinner";
  import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
  import UnfoldMoreIcon from "@hugeicons/core-free-icons/UnfoldMoreIcon";
  import CheckIcon from "@hugeicons/core-free-icons/CheckIcon";
  import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import { groupModels, modelFor, modelName, type PickerModel } from "$lib/models";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat, icon, text } from "$lib/design";

  let {
    models,
    value,
    loading = false,
    allowDefault = true,
    variant = "field",
    triggerClass = "w-56",
    disabled = false,
    agents,
    agentId,
    modelsOf,
    loadingOf,
    onBrowse,
    onSelect,
  }: {
    /** The models of the chosen agent (the trigger names one of them). */
    models: PickerModel[];
    /** The chosen model id; `""` = the CLI's own default. */
    value: string;
    /** A model-list query is in flight. */
    loading?: boolean;
    /** Offer "Default model" (a running chat always has a concrete model). */
    allowDefault?: boolean;
    /** `field` in a form or settings row; `pill` in a toolbar. */
    variant?: "field" | "pill";
    /** The `field` trigger's width (a `field.select*` token or a width class). */
    triggerClass?: string;
    disabled?: boolean;
    /** The agents to choose among; with one, only its logo shows. */
    agents?: PickerAgent[];
    /** The chosen agent (one of `agents`). */
    agentId?: string;
    /** Another agent's models, as far as they are loaded. */
    modelsOf?: (agentId: string) => PickerModel[];
    /** Whether another agent's models are still being asked for. */
    loadingOf?: (agentId: string) => boolean;
    /** The user is looking at an agent's models: load them. */
    onBrowse?: (agentId: string) => void;
    /** A model was picked — of `agentId`, which may be another agent. */
    onSelect: (id: string, agentId?: string) => void;
  } = $props();

  const DEFAULT = "__default__";
  let open = $state(false);
  /** The agent whose models the menu shows; the chosen one when it opens. */
  let browsed = $state<string | undefined>(undefined);

  const agent = $derived(agents?.find((a) => a.id === agentId));
  const railed = $derived((agents?.length ?? 0) > 1);
  const showing = $derived(browsed ?? agentId);
  const browsingOther = $derived(railed && showing !== undefined && showing !== agentId);
  const listed = $derived(browsingOther && showing ? (modelsOf?.(showing) ?? []) : models);
  const listLoading = $derived(browsingOther && showing ? (loadingOf?.(showing) ?? false) : loading);
  const shownAgent = $derived(agents?.find((a) => a.id === showing));

  const current = $derived(value ? modelFor(models, value) : undefined);
  /** The models the CLI calls older, folded at the end of the list. */
  const older = $derived(listed.filter((m) => m.isLegacy));
  const groups = $derived(groupModels(listed.filter((m) => !m.isLegacy)));
  let query = $state("");
  let olderOpen = $state(false);
  /** Folded models are searched like the rest. */
  const olderShown = $derived(olderOpen || query.trim().length > 0);
  /** Search only pays off past a screenful. */
  const searchable = $derived(listed.length > 8);
  const label = $derived(current ? modelName(current) : value || i18n.t("modelPicker.default"));
  const waiting = $derived(loading && models.length === 0);
  const listWaiting = $derived(listLoading && listed.length === 0);
  /** The row that holds the check: only on the chosen agent's own list. */
  const checked = $derived(browsingOther ? undefined : value);

  $effect(() => {
    if (open) browsed = agentId;
  });
  // A new list starts folded — unless what it has chosen is among the folded.
  $effect(() => {
    void showing;
    void open;
    query = "";
    olderOpen = untrack(() => older.some((m) => m.id === checked));
  });

  function browse(id: string) {
    const target = agents?.find((a) => a.id === id);
    if (!target?.available || id === showing) return;
    browsed = id;
    onBrowse?.(id);
  }

  function choose(id: string) {
    open = false;
    if (browsingOther) onSelect(id, showing);
    else if (id !== value) onSelect(id, agentId);
  }
</script>

{#snippet modelRow(model: PickerModel, provider: string | null)}
  <Command.Item
    value={model.id}
    keywords={[model.displayName, provider ?? ""].filter(Boolean)}
    title={model.id}
    onSelect={() => choose(model.id)}
  >
    <div class="flex min-w-0 flex-1 flex-col">
      <span class={cn("truncate", text.body)}>{modelName(model)}</span>
      {#if model.description}
        <span class={cn("truncate", text.meta)}>{model.description}</span>
      {/if}
    </div>
    {#if model.id === checked}<Icon icon={CheckIcon} class="size-3.5 shrink-0 text-primary" />{/if}
  </Command.Item>
{/snippet}

{#snippet modelList()}
  <Command.Root value={checked === undefined ? DEFAULT : checked || DEFAULT} class="min-h-0 min-w-0 flex-1">
    {#if searchable}<Command.Input bind:value={query} placeholder={i18n.t("modelPicker.search")} />{/if}
    <!-- `uxnan-scroll` = the app's thin scrollbar. -->
    <Command.List class={cn("uxnan-scroll", railed ? "max-h-none min-h-0 flex-1" : "max-h-72")}>
      {#if listWaiting}
        <div class={cn(text.meta, "flex items-center gap-2 px-3 py-2.5")}>
          <Spinner class={icon.status} />
          {i18n.t("modelPicker.loading")}
        </div>
      {/if}
      <Command.Empty>{i18n.t("modelPicker.noMatch")}</Command.Empty>
      {#if allowDefault}
        <Command.Group>
          <Command.Item value={DEFAULT} keywords={[i18n.t("modelPicker.default")]} onSelect={() => choose("")}>
            <span class={cn("flex-1 truncate", text.body)}>{i18n.t("modelPicker.default")}</span>
            {#if checked === ""}<Icon icon={CheckIcon} class="size-3.5 shrink-0 text-primary" />{/if}
          </Command.Item>
        </Command.Group>
      {/if}
      {#each groups as group (group.provider ?? "")}
        <Command.Group heading={group.provider ?? undefined}>
          {#each group.models as model (model.id)}
            {@render modelRow(model, group.provider)}
          {/each}
        </Command.Group>
      {/each}
      {#if older.length > 0}
        <Command.Group heading={olderShown ? i18n.t("modelPicker.older") : undefined}>
          {#if !olderShown}
            <Command.Item value="__older__" keywords={[i18n.t("modelPicker.older")]} onSelect={() => (olderOpen = true)}>
              <div class="flex min-w-0 flex-1 flex-col">
                <span class={cn("truncate", text.body)}>{i18n.t("modelPicker.older")}</span>
                <span class={cn("truncate", text.meta)}>
                  {i18n.t("modelPicker.olderCount", { n: String(older.length) })}
                </span>
              </div>
              <Icon icon={ArrowRight01Icon} class={cn(icon.status, "shrink-0 opacity-60")} />
            </Command.Item>
          {:else}
            {#each older as model (model.id)}
              {@render modelRow(model, null)}
            {/each}
          {/if}
        </Command.Group>
      {/if}
    </Command.List>
  </Command.Root>
{/snippet}

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <!-- {...props} first, then class — otherwise the trigger's own (empty)
           class wins and the button loses its width. -->
      <Button
        {...props}
        variant={variant === "pill" ? "ghost" : "outline"}
        size="sm"
        {disabled}
        role="combobox"
        aria-expanded={open}
        aria-label={agents ? i18n.t("modelPicker.agentLabel") : i18n.t("modelPicker.label")}
        title={agent?.label}
        class={variant === "pill"
          ? cn(chat.pill, "max-w-64", agent && "pl-2")
          : cn("justify-between font-normal", triggerClass)}
      >
        {#if agent}<AgentLogo logo={agent.logo} class={cn(icon.status, "shrink-0")} />{/if}
        <span class={variant === "pill" ? (agent ? chat.pillLabelTight : chat.pillLabel) : "truncate"}>
          {waiting ? i18n.t("modelPicker.loading") : label}
        </span>
        {#if waiting}
          <Spinner class={icon.status} aria-hidden="true" />
        {:else}
          <Icon
            icon={variant === "pill" ? ArrowDown01Icon : UnfoldMoreIcon}
            class={cn(variant === "pill" ? icon.status : "ml-1", "shrink-0 opacity-60")}
          />
        {/if}
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content width={railed ? "railedCommand" : "command"} padding="none" align="start">
    {#if railed && agents}
      <div class="flex h-80 min-h-0">
        <!-- The agents, by logo: the one shown is filled, the chosen one keeps
             a dot while another is looked at. -->
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label={i18n.t("modelPicker.agents")}
          class="uxnan-scroll flex w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border/50 py-1.5"
        >
          {#each agents as a (a.id)}
            <Tooltip.Simple title={a.note ? `${a.label} — ${a.note}` : a.label} side="left" delayDuration={300}>
              {#snippet children(props)}
                <button
                  {...props}
                  type="button"
                  role="tab"
                  aria-selected={a.id === showing}
                  aria-disabled={!a.available}
                  aria-label={a.label}
                  class={cn(
                    "relative grid size-8 shrink-0 place-items-center rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    a.id === showing ? "bg-accent" : "hover:bg-accent/60",
                    !a.available && "cursor-not-allowed opacity-40 grayscale hover:bg-transparent",
                  )}
                  onclick={() => browse(a.id)}
                >
                  <AgentLogo logo={a.logo} class={icon.brand} />
                  {#if a.id === agentId && a.id !== showing}
                    <span class="absolute top-1 right-1 size-1.5 rounded-full bg-primary"></span>
                  {/if}
                </button>
              {/snippet}
            </Tooltip.Simple>
          {/each}
        </div>
        <div class="flex min-w-0 flex-1 flex-col">
          <div class={cn(text.menuLabel, "flex h-8 shrink-0 items-center px-3")}>
            <span class="truncate">{shownAgent?.label}</span>
          </div>
          {#key showing}
            {@render modelList()}
          {/key}
        </div>
      </div>
    {:else}
      {@render modelList()}
    {/if}
  </Popover.Content>
</Popover.Root>
