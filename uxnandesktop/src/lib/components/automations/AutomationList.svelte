<script lang="ts">
  // The list — and the section that owns the create / inspect / edit loop.
  //
  // The grouping switcher is the point: an automation is rarely "one agent", so
  // the same set reads very differently depending on whether you are asking
  // "which agent does this", "what kind of task is it", "how often does it run",
  // "where does it run" or "is it healthy".
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { field, icon, iconButton, panel, text } from "$lib/design";
  import { automations } from "$lib/state/automations.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import {
    GROUP_BY_OPTIONS,
    agentsOf,
    filterAutomations,
    groupAutomations,
    isScheduled,
    type GroupBy,
  } from "$lib/automations/display";
  import { newAutomation, type Automation } from "$lib/automations/types";
  import { app } from "$lib/state/app.svelte";
  import Combobox from "$lib/components/Combobox.svelte";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import SchedulerBadge from "./SchedulerBadge.svelte";
  import AutomationDetail from "./AutomationDetail.svelte";
  import AutomationEditor from "./AutomationEditor.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Switch } from "$lib/components/ui/switch";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import PlayIcon from "@lucide/svelte/icons/play";
  import MoreHorizontalIcon from "@lucide/svelte/icons/more-horizontal";
  import CalendarClockIcon from "@lucide/svelte/icons/calendar-clock";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";

  let query = $state("");
  let groupBy = $state<GroupBy>("agent");
  /** null = the list; otherwise the automation being inspected or edited. */
  let editing = $state<Automation | null>(null);

  const selected = $derived(
    app.automationsSelectedId ? automations.byId(app.automationsSelectedId) : undefined,
  );

  const groupOptions = $derived([
    { items: GROUP_BY_OPTIONS.map((o) => ({ value: o.value, label: i18n.t(o.labelKey) })) },
  ]);
  const groups = $derived(
    groupAutomations(filterAutomations(automations.items, query), groupBy, {
      unassignedKey: i18n.t("automations.ungrouped"),
    }),
  );

  function create() {
    editing = newAutomation(crypto.randomUUID(), i18n.t("automations.newName"));
  }

  function duplicate(a: Automation) {
    editing = automations.duplicate(a, i18n.t("automations.copyOf", { name: a.name }));
  }

  // Deleting is the one action that earns a modal: it drops the automation, its
  // OS task and its whole history at once.
  let pendingDelete = $state<Automation | null>(null);
  const deleteOpen = $derived(pendingDelete !== null);

  async function confirmDelete() {
    const target = pendingDelete;
    if (!target) return;
    await automations.remove(target.id);
    if (app.automationsSelectedId === target.id) app.automationsSelectedId = null;
    pendingDelete = null;
  }
</script>

{#if editing}
  <AutomationEditor automation={editing} onback={() => (editing = null)} />
{:else if selected}
  <AutomationDetail
    automation={selected}
    onback={() => (app.automationsSelectedId = null)}
    onedit={() => (editing = selected)}
  />
{:else}
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-2">
      <Input
        class={cn(field.input, "h-8 w-56")}
        placeholder={i18n.t("automations.searchPlaceholder")}
        bind:value={query}
      />
      <Combobox
        value={groupBy}
        groups={groupOptions}
        triggerClass="w-48"
        searchPlaceholder={i18n.t("common.search")}
        onChange={(v) => (groupBy = v as GroupBy)}
      />
      <span class="flex-1"></span>
      <Button size="sm" onclick={create}>
        <PlusIcon data-icon="inline-start" />
        {i18n.t("automations.new")}
      </Button>
    </div>

    {#if !automations.schedulerSupported}
      <p class={cn("rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2", text.meta)}>
        {i18n.t("automations.schedUnsupportedTip")}
      </p>
    {/if}

    {#if automations.loading}
      <p class={text.meta}>{i18n.t("common.loading")}</p>
    {:else if automations.items.length === 0}
      <div class="flex flex-col items-center gap-1.5 py-10 text-center">
        <CalendarClockIcon class={cn(icon.empty, "text-muted-foreground/50")} />
        <p class={cn("font-medium", text.body)}>{i18n.t("automations.emptyTitle")}</p>
        <p class={cn(text.meta, "max-w-md")}>{i18n.t("automations.emptyDesc")}</p>
      </div>
    {:else if groups.length === 0}
      <p class={text.meta}>{i18n.t("automations.noMatches")}</p>
    {:else}
      {#each groups as group (group.key)}
        <div class="flex flex-col gap-1.5">
          <span class={text.section}>
            {group.labelKey ? i18n.t(group.labelKey) : group.label}
          </span>
          {#each group.items as a (a.id)}
            {@const status = automations.scheduler[a.id]}
            <div
              class={cn(
                "flex items-center gap-3 px-3 py-2.5 transition-colors hover:border-border",
                panel.card,
              )}
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-3 text-left"
                onclick={() => (app.automationsSelectedId = a.id)}
              >
                <!-- Every agent involved, not just the first: the whole point is
                     that an automation is usually several providers. -->
                <span class="flex shrink-0 -space-x-1.5">
                  {#each agentsOf(a).slice(0, 4) as agentId (agentId)}
                    <AgentLogo
                      logo={app.resolveAgent(agentId).icon}
                      class="size-5 rounded-full bg-background ring-1 ring-border/60"
                    />
                  {/each}
                </span>
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class={cn("truncate", text.bodyStrong)}>{a.name}</span>
                  <span class={cn("truncate", text.meta)}>
                    {a.steps.length === 1
                      ? i18n.t("automations.oneStep")
                      : i18n.t("automations.nSteps", { n: a.steps.length })}
                    · {a.workingDir}
                  </span>
                </span>
              </button>

              {#if !isScheduled(status) && a.enabled}
                <SchedulerBadge {status} />
              {/if}

              <TooltipSimple title={i18n.t("automations.runNow")}>
                {#snippet children(tp)}
                  <Button
                    {...tp}
                    variant="ghost"
                    size="icon-sm"
                    class={iconButton.action}
                    aria-label={i18n.t("automations.runNow")}
                    onclick={() => automations.runNow(a.id)}
                  >
                    <PlayIcon class={icon.action} />
                  </Button>
                {/snippet}
              </TooltipSimple>

              <TooltipSimple
                title={a.enabled ? i18n.t("automations.pause") : i18n.t("automations.resume")}
              >
                {#snippet children(tp)}
                  <span {...tp}>
                    <Switch
                      checked={a.enabled}
                      onCheckedChange={(c) => automations.setEnabled(a.id, c)}
                    />
                  </span>
                {/snippet}
              </TooltipSimple>

              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  {#snippet child({ props })}
                    <Button
                      {...props}
                      variant="ghost"
                      size="icon-sm"
                      class={iconButton.action}
                      aria-label={i18n.t("common.more")}
                    >
                      <MoreHorizontalIcon class={icon.action} />
                    </Button>
                  {/snippet}
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end" class="w-52">
                  <DropdownMenu.Item class={text.menu} onclick={() => (editing = a)}>
                    <PencilIcon class={icon.button} />
                    {i18n.t("common.edit")}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item class={text.menu} onclick={() => duplicate(a)}>
                    <CopyIcon class={icon.button} />
                    {i18n.t("automations.createFrom")}
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item class={text.menu} onclick={() => (pendingDelete = a)}>
                    <Trash2Icon class={icon.button} />
                    {i18n.t("common.delete")}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </div>
          {/each}
        </div>
      {/each}
    {/if}
  </div>
{/if}

<ConfirmDialog
  open={deleteOpen}
  title={i18n.t("automations.deleteTitle")}
  description={pendingDelete ? i18n.t("automations.deleteDesc", { name: pendingDelete.name }) : ""}
  confirmLabel={i18n.t("common.delete")}
  danger
  onconfirm={confirmDelete}
  oncancel={() => (pendingDelete = null)}
/>
